const mongoose = require('mongoose');

// One row per Google Ads lead-form webhook POST — the audit trail + retry
// queue. Mirrors FacebookWebhookLog.js. Never store the webhook key itself
// or any access token in `payload`; it's Google's raw webhook body only
// (Google's own security key travels in the body as google_key — it is
// validated against GoogleConnection.webhookKey in webhook.js before this
// log is even created).
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  googleLeadId: String, // Google's lead_id, or the gclid when lead_id isn't present
  campaignId: String, // Google's raw numeric campaign_id from the payload
  adGroupId: String, // Google's raw numeric adgroup_id from the payload
  adId: String, // Google's raw creative_id from the payload, when present
  formId: String,
  eventType: String, // e.g. "lead_form"
  isTest: { type: Boolean, default: false }, // Google's is_test flag — logged but never turned into a Lead

  payload: mongoose.Schema.Types.Mixed,

  processingStatus: {
    type: String,
    enum: ['received', 'processing', 'processed', 'failed', 'retrying'],
    default: 'received',
  },
  errorMessage: String,
  retryCount: { type: Number, default: 0 },
  nextRetryAt: Date,

  leadId: { type: mongoose.Schema.ObjectId, ref: 'Lead' },

  created: {
    type: Date,
    default: Date.now,
  },
  processedAt: Date,
});

module.exports = mongoose.model('GoogleWebhookLog', schema);
