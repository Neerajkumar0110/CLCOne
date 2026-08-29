const mongoose = require('mongoose');
const graph = require('@/utils/metaGraphClient');
const { findConnection, decryptedPageToken } = require('./_helpers');

// Meta's field_data[].name values vary by field type — normalize before
// matching so "Full Name", "full_name" and "FULL_NAME" all hit the same key.
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

function mapFieldData(fieldData) {
  const byNormalizedName = {};
  (fieldData || []).forEach((f) => {
    byNormalizedName[normalize(f.name)] = (f.values && f.values[0]) || '';
  });

  const mapped = {};
  Object.entries(FIELD_SYNONYMS).forEach(([leadField, synonyms]) => {
    const hit = synonyms.map(normalize).find((s) => byNormalizedName[s] !== undefined);
    if (hit !== undefined && byNormalizedName[hit]) mapped[leadField] = byNormalizedName[hit];
  });
  return mapped;
}

// GET /public/webhooks/facebook — Meta's verification handshake. Must
// respond with the raw hub.challenge value when hub.verify_token matches.
const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ success: false, result: null, message: 'Webhook verification failed' });
};

// Fetches the full lead from Meta and saves it as a Lead — shared by the
// live webhook handler and the retry job (backend/src/jobs/facebookWebhookRetry.js).
async function processWebhookLog(log) {
  const FacebookWebhookLog = mongoose.model('FacebookWebhookLog');
  const Lead = mongoose.model('Lead');

  log.processingStatus = 'processing';
  await log.save();

  const conn = await findConnection();
  const pageToken = decryptedPageToken(conn);
  if (!conn || conn.status !== 'connected' || !pageToken) {
    log.processingStatus = 'failed';
    log.errorMessage = 'No active Facebook connection with a page access token.';
    log.retryCount += 1;
    log.nextRetryAt = new Date(Date.now() + Math.min(2 ** log.retryCount, 60) * 60 * 1000);
    await log.save();
    return;
  }

  try {
    // Duplicate-proof: a leadgen_id we've already turned into a Lead is a no-op.
    const existing = await Lead.findOne({ facebookLeadId: log.leadgenId }).exec();
    if (existing) {
      log.processingStatus = 'processed';
      log.leadId = existing._id;
      log.processedAt = Date.now();
      await log.save();
      return;
    }

    const leadData = await graph.getLeadData({ leadgenId: log.leadgenId, pageAccessToken: pageToken });
    const mapped = mapFieldData(leadData.field_data);

    const lead = new Lead({
      name: mapped.name || 'Facebook Lead',
      phone: mapped.phone,
      email: mapped.email,
      budgetRange: mapped.budgetRange,
      howSoonToStart: mapped.howSoonToStart,
      message: mapped.message,
      source: 'Facebook Ads',
      status: 'New',
      color: '#1877F2',
      facebookLeadId: log.leadgenId,
      pageId: log.pageId,
      metaFormId: log.formId,
      adAccountId: conn.adAccountId,
      adId: leadData.ad_id,
      rawMetaData: leadData,
    });

    try {
      await lead.save();
    } catch (saveErr) {
      // Race with another delivery of the same webhook — the unique+sparse
      // index on facebookLeadId is the second line of defense.
      if (saveErr.code === 11000) {
        const raced = await Lead.findOne({ facebookLeadId: log.leadgenId }).exec();
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

// POST /public/webhooks/facebook — Meta's leadgen event notification. Always
// acknowledge fast (Step 16: "treat the webhook as the trigger" — the full
// lead is fetched separately, right here, before responding). Failures are
// logged and picked up by the retry job rather than lost.
const receiveWebhook = async (req, res) => {
  const FacebookWebhookLog = mongoose.model('FacebookWebhookLog');
  const entries = req.body.entry || [];

  const logs = [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;
      const value = change.value || {};
      logs.push(
        new FacebookWebhookLog({
          pageId: value.page_id,
          formId: value.form_id,
          leadgenId: value.leadgen_id,
          eventType: 'leadgen',
          payload: value,
        })
      );
    }
  }

  await Promise.all(logs.map((l) => l.save()));
  // Acknowledge immediately — processing happens after the response so a
  // slow Graph API call never risks Meta's webhook timeout/retry storm.
  res.status(200).json({ success: true, result: null, message: 'Received' });

  for (const log of logs) {
    processWebhookLog(log).catch(() => {}); // errors are already captured on the log itself
  }
};

module.exports = { verifyWebhook, receiveWebhook, processWebhookLog, mapFieldData };
