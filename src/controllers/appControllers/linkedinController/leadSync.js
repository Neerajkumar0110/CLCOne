const mongoose = require('mongoose');
const client = require('../../../utils/linkedinAdsClient');
const { findConnection, isTokenExpired, decryptedAccessToken } = require('./_helpers');

// LinkedIn has NO webhook for Lead Gen Forms — this file (together with
// jobs/linkedinLeadPoller.js, which calls runPollCycle() on a timer) IS the
// primary lead-capture mechanism for LinkedIn, not a retry-only path the
// way facebookController/webhook.js's retry job is. Every lead a
// LinkedIn Lead Gen Form ever produces arrives through here.

// LinkedIn's form-response answers arrive as a list of {question, answer}
// shaped entries (per LinkedIn's Lead Sync API) — normalize the question
// text the same way facebookController/webhook.js's FIELD_SYNONYMS /
// mapFieldData match Meta's field_data[].name values, so "First Name",
// "first_name" and "FIRST NAME" all hit the same key.
function normalize(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const FIELD_SYNONYMS = {
  firstName: ['firstname'],
  lastName: ['lastname'],
  name: ['fullname', 'name'],
  email: ['emailaddress', 'email', 'workemail'],
  phone: ['phonenumber', 'phone', 'mobilenumber'],
  company: ['companyname', 'company', 'employer'],
  jobTitle: ['jobtitle', 'title'],
  budgetRange: ['budgetrange', 'budget'],
  howSoonToStart: ['howsoontostart', 'howsoon'],
  message: ['message', 'comments'],
};

function mapAnswersToLead(answers) {
  const byNormalizedQuestion = {};
  (answers || []).forEach((a) => {
    byNormalizedQuestion[normalize(a.question)] = a.answer || '';
  });

  const mapped = {};
  Object.entries(FIELD_SYNONYMS).forEach(([leadField, synonyms]) => {
    const hit = synonyms.map(normalize).find((s) => byNormalizedQuestion[s] !== undefined);
    if (hit !== undefined && byNormalizedQuestion[hit]) mapped[leadField] = byNormalizedQuestion[hit];
  });

  if (!mapped.name && (mapped.firstName || mapped.lastName)) {
    mapped.name = [mapped.firstName, mapped.lastName].filter(Boolean).join(' ');
  }

  return mapped;
}

// Turns one LinkedIn lead form response into a Lead document. Shared by
// runPollCycle() (fresh polls) and retrySyncLog() (the poller job's retry
// path) so both go through identical dedupe/mapping logic.
async function processFormResponse(response, { form, conn }) {
  const Lead = mongoose.model('Lead');

  // LinkedIn's response id (URN/id string) is this integration's dedupe key
  // — the parallel to Meta's leadgen_id / Lead.facebookLeadId.
  const responseId = response.id || response.entityUrn;
  if (!responseId) throw new Error('LinkedIn lead form response had no id.');

  const existing = await Lead.findOne({ linkedinLeadId: responseId }).exec();
  if (existing) return { created: false, duplicate: true };

  const mapped = mapAnswersToLead(response.answers);

  const lead = new Lead({
    name: mapped.name || 'LinkedIn Lead',
    phone: mapped.phone,
    email: mapped.email,
    budgetRange: mapped.budgetRange,
    howSoonToStart: mapped.howSoonToStart,
    message: mapped.message || [mapped.company, mapped.jobTitle].filter(Boolean).join(' — '),
    source: 'LinkedIn Ads',
    status: 'New',
    color: '#0A66C2', // LinkedIn brand blue
    linkedinLeadId: responseId,
    organizationId: conn.organizationId,
    adAccountId: conn.adAccountId,
    linkedinFormId: form.id,
    // Plain strings, not ObjectId refs — see the note on Lead.adId's bug in
    // the LinkedIn integration handoff. response.campaign/response.creative
    // are LinkedIn URNs (e.g. urn:li:sponsoredCampaign:123), never this
    // app's local Mongo _id, so an ObjectId ref field would fail to save the
    // moment a real one came through, exactly like Meta's adId bug.
    linkedinCampaignId: response.campaign,
    linkedinCreativeId: response.creative,
    rawLinkedInData: response,
  });

  try {
    await lead.save();
  } catch (saveErr) {
    // Race with another poll tick picking up the same response — the
    // unique+sparse index on linkedinLeadId is the second line of defense.
    if (saveErr.code === 11000) {
      return { created: false, duplicate: true };
    }
    throw saveErr;
  }

  return { created: true };
}

// Exponential backoff identical to facebookController/webhook.js's
// processWebhookLog / jobs/facebookWebhookRetry.js's MAX_ATTEMPTS shape.
const MAX_ATTEMPTS = 5;
function scheduleRetry(log, err) {
  log.retryCount += 1;
  log.processingStatus = log.retryCount >= MAX_ATTEMPTS ? 'failed' : 'retrying';
  log.errorMessage = err.message;
  log.nextRetryAt = new Date(Date.now() + Math.min(2 ** log.retryCount, 60) * 60 * 1000);
}

// Fetches and processes responses for a single Lead Gen Form, logging the
// fetch as one LinkedInLeadSyncLog row. Shared by runPollCycle() (creates a
// fresh log per form per cycle) and retrySyncLog() (re-runs an existing
// due-for-retry log against the same window).
async function syncForm({ form, conn, accessToken, log }) {
  log.processingStatus = 'processing';
  await log.save();

  try {
    const responses = await client.getLeadFormResponses({
      accessToken,
      formUrn: form.id,
      since: log.pollWindowStart,
    });

    log.responsesFetched = responses.length;
    let leadsCreated = 0;
    let leadsSkipped = 0;

    for (const response of responses) {
      const result = await processFormResponse(response, { form, conn });
      if (result.created) leadsCreated += 1;
      else leadsSkipped += 1;
    }

    log.leadsCreated = leadsCreated;
    log.leadsSkipped = leadsSkipped;
    log.processingStatus = 'processed';
    log.errorMessage = undefined;
    log.processedAt = Date.now();
    await log.save();
    return true;
  } catch (err) {
    scheduleRetry(log, err);
    await log.save();
    return false;
  }
}

// The main poll cycle — called on a timer by jobs/linkedinLeadPoller.js
// (and available for an on-demand admin trigger via triggerSync below).
// Fetches every Lead Gen Form owned by the connected Organization and pulls
// responses submitted since the last successful cycle's watermark
// (conn.lastPolledAt).
async function runPollCycle() {
  const LinkedInLeadSyncLog = mongoose.model('LinkedInLeadSyncLog');
  const conn = await findConnection();

  if (!conn || conn.status !== 'connected') return { skipped: true, reason: 'LinkedIn is not connected.' };

  if (isTokenExpired(conn)) {
    conn.status = 'expired';
    conn.updated = Date.now();
    await conn.save();
    return { skipped: true, reason: 'LinkedIn access token has expired — reconnect via OAuth.' };
  }

  if (!conn.organizationId || !conn.adAccountId) {
    return { skipped: true, reason: 'Select a LinkedIn Organization and Ad Account first.' };
  }

  const accessToken = decryptedAccessToken(conn);
  const pollStartedAt = new Date();
  const pollWindowStart = conn.lastPolledAt || new Date(pollStartedAt.getTime() - 24 * 60 * 60 * 1000);

  let forms;
  try {
    forms = await client.getLeadForms({ accessToken, organizationId: conn.organizationId });
  } catch (err) {
    conn.lastError = `Lead form list fetch failed: ${err.message}`;
    await conn.save();
    return { skipped: true, reason: conn.lastError };
  }

  let allSucceeded = true;
  const summary = [];

  for (const form of forms) {
    const log = new LinkedInLeadSyncLog({
      adAccountId: conn.adAccountId,
      organizationId: conn.organizationId,
      formId: form.id,
      formName: form.name,
      pollWindowStart,
    });
    const ok = await syncForm({ form, conn, accessToken, log });
    if (!ok) allSucceeded = false;
    summary.push({ formId: form.id, formName: form.name, responsesFetched: log.responsesFetched, leadsCreated: log.leadsCreated });
  }

  // Only advance the watermark once every form synced cleanly — a partial
  // failure must not silently skip that form's window on the next cycle.
  if (allSucceeded) {
    conn.lastPolledAt = pollStartedAt;
    conn.lastError = undefined;
    await conn.save();
  }

  return { skipped: false, formsPolled: forms.length, allSucceeded, summary };
}

// Re-runs one failed/retrying log against its original pollWindowStart —
// called by jobs/linkedinLeadPoller.js's retry pass, mirroring
// jobs/facebookWebhookRetry.js's re-invocation of processWebhookLog.
async function retrySyncLog(log) {
  const conn = await findConnection();
  if (!conn || conn.status !== 'connected' || isTokenExpired(conn)) {
    scheduleRetry(log, new Error('LinkedIn is not connected or the token has expired.'));
    await log.save();
    return;
  }

  const accessToken = decryptedAccessToken(conn);
  await syncForm({
    form: { id: log.formId, name: log.formName },
    conn,
    accessToken,
    log,
  });
}

// GET /api/linkedin/lead-sync-logs — audit trail for admins, newest first.
const getSyncLogs = async (req, res) => {
  const LinkedInLeadSyncLog = mongoose.model('LinkedInLeadSyncLog');
  const result = await LinkedInLeadSyncLog.find({ removed: false }).sort({ created: -1 }).limit(200).exec();
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/linkedin/lead-sync/trigger — lets an admin run a poll cycle
// on demand instead of waiting for the next timer tick (useful right after
// connecting, or after publishing a new Lead Gen Form).
const triggerSync = async (req, res) => {
  try {
    const result = await runPollCycle();
    return res.status(200).json({ success: true, result, message: 'Lead sync cycle complete' });
  } catch (err) {
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = {
  getSyncLogs,
  triggerSync,
  runPollCycle,
  retrySyncLog,
  mapAnswersToLead,
};
