const mongoose = require('mongoose');

// Pulls Facebook Lead Ads leads into the CRM by POLLING the Graph API —
// every lead form on every connected Page (forms built in Meta Ads Manager
// included; nothing has to be created from the CRM).
//
// Why polling and not just the webhook (facebookController/webhook.js):
// Meta only delivers real leadgen webhooks to a PUBLISHED app, and
// publishing waits on Business Verification. Reading leads with the Page
// token works without that, so this is what actually brings leads in until
// (and alongside) the webhook. Both paths funnel into the same
// processWebhookLog() — same field mapping, same Lead shape — and
// Lead.facebookLeadId is unique, so a lead seen by both is saved once.
//
// Each tick, per connected Page: list its lead forms, fetch leads created
// after the Page's watermark (FacebookConnection.leadsPolledAt; first run
// looks back FACEBOOK_POLL_BACKFILL_DAYS), and hand each one not already
// in the CRM to processWebhookLog via a FacebookWebhookLog row — so a
// failure is retried by jobs/facebookWebhookRetry.js like a webhook one.
// 1 min: a fresh lead gets an instant call (services/calling/instantLeads.js),
// so it has to land fast. Only ACTIVE forms are read each tick.
const POLL_INTERVAL_MS = Number(process.env.FACEBOOK_POLL_INTERVAL_MS) || 60 * 1000;
const BACKFILL_DAYS = Number(process.env.FACEBOOK_POLL_BACKFILL_DAYS) || 30;
// Re-read a little before the watermark so a lead that landed while the
// previous tick was mid-run is never skipped (duplicates are dropped).
const OVERLAP_MS = 10 * 60 * 1000;

let running = false;

async function pollConnection(conn) {
  const graph = require('../utils/metaGraphClient');
  const { decryptedPageToken } = require('../controllers/appControllers/marketing/facebookController/_helpers');
  const { processWebhookLog } = require('../controllers/appControllers/marketing/facebookController/webhook');
  const FacebookWebhookLog = mongoose.model('FacebookWebhookLog');
  const Lead = mongoose.model('Lead');

  const pageAccessToken = decryptedPageToken(conn);
  if (!pageAccessToken || !conn.pageId) return { forms: 0, created: 0 };

  const tickStart = new Date();
  const since = conn.leadsPolledAt
    ? new Date(conn.leadsPolledAt.getTime() - OVERLAP_MS)
    : new Date(Date.now() - BACKFILL_DAYS * 86400000);
  const sinceUnix = Math.floor(since.getTime() / 1000);

  const forms = (await graph.listLeadForms({ pageId: conn.pageId, pageAccessToken })).filter(
    (f) => !f.status || f.status === 'ACTIVE'
  );
  let created = 0;
  for (const form of forms) {
    const leads = await graph.listFormLeads({ formId: form.id, pageAccessToken, sinceUnix });
    for (const l of leads) {
      if (await Lead.exists({ facebookLeadId: l.id })) continue;
      if (await FacebookWebhookLog.exists({ leadgenId: l.id, processingStatus: { $in: ['processing', 'retrying', 'processed'] } })) continue;
      const log = await new FacebookWebhookLog({
        pageId: conn.pageId,
        formId: form.id,
        leadgenId: l.id,
        eventType: 'leadgen-poll',
        payload: { ...l, form_name: form.name },
      }).save();
      await processWebhookLog(log);
      created += 1;
    }
  }

  conn.leadsPolledAt = tickStart;
  conn.leadsPollError = undefined;
  await conn.save();
  return { forms: forms.length, created };
}

async function pollOnce() {
  if (running || mongoose.connection.readyState !== 1) return;
  running = true;
  try {
    const FacebookConnection = mongoose.model('FacebookConnection');
    const conns = await FacebookConnection.find({ removed: false, status: 'connected', pageId: { $nin: [null, ''] } }).exec();
    for (const conn of conns) {
      try {
        const r = await pollConnection(conn);
        if (r.created) console.log(`[facebookLeadPoller] ${conn.pageName || conn.pageId}: ${r.created} new lead(s) from ${r.forms} form(s)`);
      } catch (err) {
        // One Page's bad token / permission error must not stop the others.
        console.error(`[facebookLeadPoller] ${conn.pageName || conn.pageId}:`, err.message);
        conn.leadsPollError = err.message;
        await conn.save().catch(() => {});
      }
    }
  } catch (err) {
    console.error('[facebookLeadPoller] tick failed:', err.message);
  } finally {
    running = false;
  }
}

function startFacebookLeadPoller() {
  setTimeout(pollOnce, 30 * 1000); // first pass shortly after boot
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

module.exports = startFacebookLeadPoller;
module.exports.pollOnce = pollOnce;
