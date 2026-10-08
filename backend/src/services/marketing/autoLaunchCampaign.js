const mongoose = require('mongoose');
const metaGraph = require('../../utils/metaGraphClient');
const metaTokenCrypto = require('../../utils/metaTokenCrypto');
const googleGraph = require('../../utils/googleAdsClient');
const linkedinClient = require('../../utils/linkedinAdsClient');

// Fires the moment a Facebook/Google/LinkedIn Ads account finishes
// connecting (see each platform's callback.js) and — using a saved
// AdCampaignTemplate — builds the SAME campaign → ad set/group → creative →
// ad chain the manual Campaign Setup UI builds (pages/Leads/CaptureForm.jsx),
// just driven by the template instead of an admin clicking through it.
// Fires for every account that connects, independently — connecting five
// Facebook ad accounts launches the same template into all five.
//
// Reuses the real controller functions (not a reimplementation) via a
// minimal in-process req/res — one place still owns "how to build a Meta/
// Google/LinkedIn campaign", the HTTP routes and this auto-launch path both
// call it. Those controllers all resolve "which account" via
// _helpers.js#findConnection(), which only ever looks at whichever
// connection is marked `active` — so withActiveConnection() below briefly
// makes the ONE account auto-launch is building for the active one for the
// duration of this run, then restores whatever was active before. Safe for
// this app's actual usage pattern (one admin, auto-launch only runs right
// after a deliberate connect action) — not safe under truly concurrent
// auto-launches for the same platform, which this app has no need for.
//
// Deliberately stops short of the final Publish step on every platform.
// The existing codebase creates every campaign/ad set/creative/ad PAUSED
// and treats "never auto-activate, never spend money automatically" as a
// hard rule (see the comments on facebookController/campaigns.js,
// googleController/campaigns.js, linkedinController/campaignGroups.js).
// Auto-launch builds everything up to that line and stops — a manager
// still reviews and clicks Publish on the Capture Form ▸ Campaign Setup
// tab (having first made the target account active from the Connected
// Accounts list) before anything actually spends. That's the one
// deliberate manual step this feature keeps.
//
// Google has no Lead Form creation/selection concept at all in this
// codebase (its Lead Form webhook is configured by hand in the Google Ads
// UI) — so a Google template is plain Responsive Search Ad copy, no form.
// LinkedIn has no Lead Gen Form creation API either — template.leadGenFormId
// must already exist (created by hand in LinkedIn Campaign Manager).

function invoke(fn, { body = {}, query = {}, params = {}, upload } = {}) {
  return new Promise((resolve) => {
    const req = { body, query, params, upload };
    const res = {
      _status: 200,
      status(c) {
        this._status = c;
        return this;
      },
      set() {
        return this;
      },
      json(payload) {
        resolve({ httpStatus: this._status, ...payload });
      },
    };
    Promise.resolve(fn(req, res)).catch((err) => resolve({ httpStatus: 500, success: false, message: err.message }));
  });
}

async function markRun(templateId, success, error, steps) {
  const AdCampaignTemplate = mongoose.model('AdCampaignTemplate');
  await AdCampaignTemplate.updateOne(
    { _id: templateId },
    {
      $set: {
        lastRunAt: new Date(),
        lastRunStatus: success ? 'success' : 'failed',
        lastRunError: error || undefined,
        lastRunSteps: steps || undefined,
      },
    }
  );
}

// Makes `connId` the active row on `Model` for the duration of `fn(conn)`,
// then restores whichever row was active beforehand (no-op if `connId` was
// already active). `fn` receives the live, already-active connection doc.
async function withActiveConnection(Model, connId, fn) {
  const target = await Model.findOne({ _id: connId, removed: false });
  if (!target) throw new Error('This account is no longer connected.');

  if (target.active) {
    return fn(target);
  }

  const previouslyActive = await Model.findOne({ removed: false, active: true, _id: { $ne: connId } });
  await Model.updateMany({ removed: false, _id: { $ne: connId } }, { $set: { active: false } });
  target.active = true;
  await target.save();

  try {
    return await fn(target);
  } finally {
    await Model.updateMany({ removed: false }, { $set: { active: false } });
    const restoreId = previouslyActive ? previouslyActive._id : connId;
    await Model.updateOne({ _id: restoreId }, { $set: { active: true } });
  }
}

// ───────────────────────── Facebook ─────────────────────────
async function autoLaunchFacebook(connectionId) {
  const AdCampaignTemplate = mongoose.model('AdCampaignTemplate');
  const template = await AdCampaignTemplate.findOne({ platform: 'facebook', enabled: true, removed: false });
  if (!template) return;

  const FacebookConnection = mongoose.model('FacebookConnection');

  const steps = {};
  try {
    await withActiveConnection(FacebookConnection, connectionId, async (conn) => {
      if (conn.status !== 'connected') return;

      // Auto-select the first Page + Ad Account if nothing's been chosen
      // yet for THIS account (mirrors facebookController/connection.js's
      // updateConnection).
      if (!conn.pageId || !conn.adAccountId) {
        const userToken = metaTokenCrypto.decrypt(conn.userAccessToken);
        if (!conn.pageId) {
          const pages = await metaGraph.getPages(userToken);
          if (!pages.length) throw new Error('No Facebook Pages available on this account.');
          conn.pageId = pages[0].id;
          conn.pageName = pages[0].name;
          conn.pageAccessToken = metaTokenCrypto.encrypt(pages[0].access_token);
          try {
            await metaGraph.subscribePageWebhook({ pageId: pages[0].id, pageAccessToken: pages[0].access_token });
            conn.webhookSubscribed = true;
          } catch (e) {
            conn.lastError = `Webhook subscription failed: ${e.message}`;
          }
        }
        if (!conn.adAccountId) {
          const accounts = await metaGraph.getAdAccounts(userToken);
          if (!accounts.length) throw new Error('No Facebook Ad Accounts available on this account.');
          conn.adAccountId = accounts[0].id;
          conn.adAccountName = accounts[0].name;
        }
        conn.updated = Date.now();
        await conn.save();
      }
      steps.accountSelect = 'ok';

      const CaptureFormConfig = mongoose.model('CaptureFormConfig');
      let formConfig = await CaptureFormConfig.findOne({ removed: false, platform: 'Facebook Ads' });
      if (!formConfig) throw new Error('Save the Facebook capture form fields first (Capture Form tab) before enabling auto-launch.');
      if (!formConfig.metaFormId) {
        if (!template.privacyPolicyUrl) throw new Error('Template is missing a Privacy Policy URL — required by Meta to create the Lead Form.');
        const r = await invoke(require('../../controllers/appControllers/marketing/facebookController/forms').createForm, {
          body: { privacyPolicyUrl: template.privacyPolicyUrl, name: template.campaignName },
        });
        if (!r.success) throw new Error(r.message || 'Could not create the Facebook Lead Form.');
        formConfig = await CaptureFormConfig.findOne({ removed: false, platform: 'Facebook Ads' });
      }
      steps.leadForm = 'ok';

      const campaignsCtl = require('../../controllers/appControllers/marketing/facebookController/campaigns');
      const adsetsCtl = require('../../controllers/appControllers/marketing/facebookController/adsets');
      const creativesCtl = require('../../controllers/appControllers/marketing/facebookController/creatives');
      const adsCtl = require('../../controllers/appControllers/marketing/facebookController/ads');

      const campRes = await invoke(campaignsCtl.createCampaign, {
        body: { name: template.campaignName, objective: template.objective },
      });
      if (!campRes.success) throw new Error(campRes.message || 'Could not create the campaign.');
      steps.campaign = 'ok';

      if (!template.dailyBudget) throw new Error('Template is missing a daily budget.');
      const adsetRes = await invoke(adsetsCtl.createAdSet, {
        body: {
          name: `${template.campaignName} — Ad Set`,
          campaignId: campRes.result._id,
          dailyBudget: template.dailyBudget,
          countries: template.countries,
          ageMin: template.ageMin,
          ageMax: template.ageMax,
          genders: template.genders,
          placements: template.placements,
          optimizationGoal: template.optimizationGoal,
          billingEvent: template.billingEvent,
        },
      });
      if (!adsetRes.success) throw new Error(adsetRes.message || 'Could not create the ad set.');
      steps.adSet = 'ok';

      if (!template.mediaFilePath) throw new Error('Template is missing creative media (image/video).');
      const creativeRes = await invoke(creativesCtl.createCreative, {
        body: {
          name: `${template.campaignName} — Creative`,
          campaignId: campRes.result._id,
          adSetId: adsetRes.result._id,
          primaryText: template.primaryText,
          headline: template.headline,
          description: template.description,
          callToAction: template.callToAction,
          metaFormId: formConfig.metaFormId,
          mediaType: template.mediaType,
        },
        upload: { filePath: template.mediaFilePath, fileName: template.mediaFileName },
      });
      if (!creativeRes.success) throw new Error(creativeRes.message || 'Could not create the ad creative.');
      steps.creative = 'ok';

      const adRes = await invoke(adsCtl.createAd, {
        body: {
          name: `${template.campaignName} — Ad`,
          campaignId: campRes.result._id,
          adSetId: adsetRes.result._id,
          creativeId: creativeRes.result._id,
        },
      });
      if (!adRes.success) throw new Error(adRes.message || 'Could not create the ad.');
      steps.ad = 'ok';
    });

    await markRun(template._id, true, null, steps);
  } catch (err) {
    await markRun(template._id, false, err.message, steps);
  }
}

// ───────────────────────── Google ─────────────────────────
async function autoLaunchGoogle(connectionId) {
  const AdCampaignTemplate = mongoose.model('AdCampaignTemplate');
  const template = await AdCampaignTemplate.findOne({ platform: 'google', enabled: true, removed: false });
  if (!template) return;

  const GoogleConnection = mongoose.model('GoogleConnection');

  const steps = {};
  try {
    await withActiveConnection(GoogleConnection, connectionId, async (conn) => {
      if (conn.status !== 'connected') return;

      const { getFreshAccessToken } = require('../../controllers/appControllers/marketing/googleController/_helpers');
      if (!conn.customerId) {
        const accessToken = await getFreshAccessToken(conn);
        const ids = await googleGraph.listAccessibleCustomers(accessToken);
        if (!ids.length) throw new Error('No Google Ads accounts accessible on this connection.');
        conn.customerId = ids[0];
        conn.updated = Date.now();
        await conn.save();
      }
      steps.accountSelect = 'ok';

      if (!template.dailyBudgetMicros) throw new Error('Template is missing a daily budget (micros).');
      if ((template.headlines || []).length < 3 || (template.descriptions || []).length < 2 || !(template.finalUrls || []).length) {
        throw new Error('Template needs at least 3 headlines, 2 descriptions and 1 final URL (Google Responsive Search Ad requirement).');
      }

      const campaignsCtl = require('../../controllers/appControllers/marketing/googleController/campaigns');
      const adgroupsCtl = require('../../controllers/appControllers/marketing/googleController/adgroups');
      const adsCtl = require('../../controllers/appControllers/marketing/googleController/ads');

      const campRes = await invoke(campaignsCtl.createCampaign, {
        body: { name: template.campaignName, advertisingChannelType: template.advertisingChannelType, dailyBudgetMicros: template.dailyBudgetMicros },
      });
      if (!campRes.success) throw new Error(campRes.message || 'Could not create the campaign.');
      steps.campaign = 'ok';

      const adgroupRes = await invoke(adgroupsCtl.createAdGroup, {
        body: { name: `${template.campaignName} — Ad Group`, campaignId: campRes.result._id, cpcBidMicros: template.cpcBidMicros },
      });
      if (!adgroupRes.success) throw new Error(adgroupRes.message || 'Could not create the ad group.');
      steps.adGroup = 'ok';

      const adRes = await invoke(adsCtl.createAd, {
        body: {
          name: `${template.campaignName} — Ad`,
          campaignId: campRes.result._id,
          adGroupId: adgroupRes.result._id,
          headlines: template.headlines,
          descriptions: template.descriptions,
          finalUrls: template.finalUrls,
        },
      });
      if (!adRes.success) throw new Error(adRes.message || 'Could not create the ad.');
      steps.ad = 'ok';
    });

    await markRun(template._id, true, null, steps);
  } catch (err) {
    await markRun(template._id, false, err.message, steps);
  }
}

// ───────────────────────── LinkedIn ─────────────────────────
async function autoLaunchLinkedIn(connectionId) {
  const AdCampaignTemplate = mongoose.model('AdCampaignTemplate');
  const template = await AdCampaignTemplate.findOne({ platform: 'linkedin', enabled: true, removed: false });
  if (!template) return;

  const LinkedInConnection = mongoose.model('LinkedInConnection');
  const { isTokenExpired, decryptedAccessToken } = require('../../controllers/appControllers/marketing/linkedinController/_helpers');

  const steps = {};
  try {
    await withActiveConnection(LinkedInConnection, connectionId, async (conn) => {
      if (conn.status !== 'connected') return;
      // LinkedIn issues no refresh token — an expired one needs a human
      // reconnect via OAuth, there's nothing auto-launch can silently fix.
      if (isTokenExpired(conn)) return;

      if (!conn.organizationId || !conn.adAccountId) {
        const accessToken = decryptedAccessToken(conn);
        if (!conn.organizationId) {
          const acls = await linkedinClient.getOrganizationAcls(accessToken);
          const first = acls[0];
          if (!first) throw new Error('No LinkedIn Organizations available on this account.');
          const orgId = (first.organization || '').split(':').pop() || first.organizationTarget;
          conn.organizationId = orgId;
          conn.organizationName = first.organizationName || orgId;
        }
        if (!conn.adAccountId) {
          const accounts = await linkedinClient.getAdAccounts(accessToken);
          if (!accounts.length) throw new Error('No LinkedIn Ad Accounts available on this account.');
          conn.adAccountId = accounts[0].id;
          conn.adAccountName = accounts[0].name;
        }
        conn.updated = Date.now();
        await conn.save();
      }
      steps.accountSelect = 'ok';

      if (!template.leadGenFormId) {
        throw new Error('Template is missing a LinkedIn Lead Gen Form ID — create one by hand in LinkedIn Campaign Manager first (LinkedIn has no API to create one).');
      }
      if (!template.mediaFilePath) throw new Error('Template is missing creative media (image).');

      const campaignGroupsCtl = require('../../controllers/appControllers/marketing/linkedinController/campaignGroups');
      const campaignsCtl = require('../../controllers/appControllers/marketing/linkedinController/campaigns');
      const creativesCtl = require('../../controllers/appControllers/marketing/linkedinController/creatives');

      const groupRes = await invoke(campaignGroupsCtl.createCampaignGroup, {
        body: { name: template.campaignName, totalBudget: template.totalBudget },
      });
      if (!groupRes.success) throw new Error(groupRes.message || 'Could not create the campaign group.');
      steps.campaignGroup = 'ok';

      if (!template.dailyBudget && !template.totalBudget) throw new Error('Template is missing a daily or total budget.');
      const campRes = await invoke(campaignsCtl.createCampaign, {
        body: {
          name: `${template.campaignName} — Campaign`,
          campaignGroupId: groupRes.result._id,
          dailyBudget: template.dailyBudget,
          totalBudget: template.totalBudget,
          locations: template.locations,
        },
      });
      if (!campRes.success) throw new Error(campRes.message || 'Could not create the campaign.');
      steps.campaign = 'ok';

      const creativeRes = await invoke(creativesCtl.createCreative, {
        body: {
          name: `${template.campaignName} — Creative`,
          campaignId: campRes.result._id,
          commentary: template.commentary,
          headline: template.headline,
          landingPageUrl: template.landingPageUrl,
          callToAction: template.callToAction || 'Submit',
          leadGenFormId: template.leadGenFormId,
        },
        upload: { filePath: template.mediaFilePath, fileName: template.mediaFileName },
      });
      if (!creativeRes.success) throw new Error(creativeRes.message || 'Could not create the creative.');
      steps.creative = 'ok';
    });

    await markRun(template._id, true, null, steps);
  } catch (err) {
    await markRun(template._id, false, err.message, steps);
  }
}

const RUNNERS = { facebook: autoLaunchFacebook, google: autoLaunchGoogle, linkedin: autoLaunchLinkedIn };

// Fire-and-forget — called right after a platform's OAuth callback saves
// status:'connected' for THIS specific connection id, so the popup window
// still closes immediately while the campaign build happens in the
// background. Mirrors services/lms/certificateEngine.js's evaluateSafe.
function autoLaunchSafe(platform, connectionId) {
  const fn = RUNNERS[platform];
  if (!fn || !connectionId) return;
  Promise.resolve()
    .then(() => fn(connectionId))
    .catch((e) => console.error(`[marketing] auto-launch ${platform} failed:`, e.message));
}

module.exports = { autoLaunchFacebook, autoLaunchGoogle, autoLaunchLinkedIn, autoLaunchSafe };
