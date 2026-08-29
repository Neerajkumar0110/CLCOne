const mongoose = require('mongoose');
const { findConnection } = require('./_helpers');

// Google's user_column_data[].column_id values are the built-in field types
// (FULL_NAME, EMAIL, PHONE_NUMBER, ...) or the advertiser's own custom
// question text — normalize before matching so different casings/labels all
// hit the same key. Same approach as facebookController/webhook.js's
// FIELD_SYNONYMS/mapFieldData for Meta's field_data.
function normalize(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const FIELD_SYNONYMS = {
  name: ['fullname', 'name'],
  email: ['email'],
  phone: ['phonenumber', 'phone', 'whatsapp', 'whatsappnumber'],
  budgetRange: ['budgetrange', 'budget'],
  howSoonToStart: ['howsoontostart', 'howsoon'],
  message: ['message'],
};

function mapFieldData(userColumnData) {
  const byNormalizedKey = {};
  (userColumnData || []).forEach((f) => {
    const key = normalize(f.column_id || f.column_name);
    byNormalizedKey[key] = f.string_value || '';
  });

  const mapped = {};
  Object.entries(FIELD_SYNONYMS).forEach(([leadField, synonyms]) => {
    const hit = synonyms.map(normalize).find((s) => byNormalizedKey[s] !== undefined);
    if (hit !== undefined && byNormalizedKey[hit]) mapped[leadField] = byNormalizedKey[hit];
  });
  return mapped;
}

// Turns a logged Google lead-form webhook payload into a Lead — shared by
// the live webhook handler and the retry job
// (backend/src/jobs/googleWebhookRetry.js). Unlike Facebook's
// processWebhookLog, there's no separate "fetch the full lead" API call:
// Google's webhook delivery already carries the full lead payload
// (user_column_data) in the POST body, so this works entirely off log.payload.
async function processWebhookLog(log) {
  const Lead = mongoose.model('Lead');

  log.processingStatus = 'processing';
  await log.save();

  // Google marks synthetic test submissions (sent from the Ads UI's "Send
  // test lead" button) with is_test — log them for visibility but never
  // create a real Lead from one.
  if (log.isTest) {
    log.processingStatus = 'processed';
    log.processedAt = Date.now();
    await log.save();
    return;
  }

  try {
    // Duplicate-proof: a lead_id (or gclid fallback) we've already turned
    // into a Lead is a no-op.
    const existing = await Lead.findOne({ googleLeadId: log.googleLeadId }).exec();
    if (existing) {
      log.processingStatus = 'processed';
      log.leadId = existing._id;
      log.processedAt = Date.now();
      await log.save();
      return;
    }

    const mapped = mapFieldData(log.payload && log.payload.user_column_data);

    const lead = new Lead({
      name: mapped.name || 'Google Lead',
      phone: mapped.phone,
      email: mapped.email,
      budgetRange: mapped.budgetRange,
      howSoonToStart: mapped.howSoonToStart,
      message: mapped.message,
      source: 'Google Ads',
      status: 'New',
      color: '#4285F4',
      googleLeadId: log.googleLeadId,
      googleCampaignId: log.campaignId,
      googleAdGroupId: log.adGroupId,
      googleAdId: log.adId,
      rawGoogleData: log.payload,
    });

    try {
      await lead.save();
    } catch (saveErr) {
      // Race with another delivery of the same webhook — the unique+sparse
      // index on googleLeadId is the second line of defense.
      if (saveErr.code === 11000) {
        const raced = await Lead.findOne({ googleLeadId: log.googleLeadId }).exec();
        log.leadId = raced ? raced._id : undefined;
      } else {
        throw saveErr;
      }
    }

    log.processingStatus = 'processed';
    log.leadId = log.leadId || lead._id;
    log.processedAt = Date.now();
    log.errorMessage = undefined;
    await log.save();
  } catch (err) {
    log.processingStatus = log.retryCount + 1 >= 5 ? 'failed' : 'retrying';
    log.errorMessage = err.message;
    log.retryCount += 1;
    log.nextRetryAt = new Date(Date.now() + Math.min(2 ** log.retryCount, 60) * 60 * 1000);
    await log.save();
  }
}

// POST /public/google/webhook — Google's Lead Form webhook delivery.
// Structurally different from Facebook's webhook: there is no OAuth-
// triggered subscription and no verification handshake (no hub.challenge
// equivalent). The advertiser pastes this URL + a security key directly into
// the Lead form asset inside the Google Ads UI ("Connect to a CRM using
// webhook integration"). The only proof a request genuinely came from that
// configured integration is that it carries the same key back — Google
// includes it as google_key in the POST body — so that's checked against
// GoogleConnection.webhookKey before anything is trusted or saved.
const receiveWebhook = async (req, res) => {
  const GoogleWebhookLog = mongoose.model('GoogleWebhookLog');
  const body = req.body || {};

  const conn = await findConnection();
  if (!conn || !conn.webhookKey || body.google_key !== conn.webhookKey) {
    return res.status(401).json({ success: false, result: null, message: 'Invalid or missing google_key.' });
  }

  const log = new GoogleWebhookLog({
    googleLeadId: body.lead_id || body.gcl_id || body.gclid,
    campaignId: body.campaign_id,
    adGroupId: body.adgroup_id,
    adId: body.creative_id,
    formId: body.form_id,
    eventType: 'lead_form',
    isTest: !!body.is_test,
    payload: body,
  });
  await log.save();

  // Acknowledge immediately — processing happens after the response so it
  // never risks Google's webhook delivery timeout/retry behavior.
  res.status(200).json({ success: true, result: null, message: 'Received' });

  processWebhookLog(log).catch(() => {}); // errors are already captured on the log itself
};

module.exports = { receiveWebhook, processWebhookLog, mapFieldData };
