const mongoose = require('mongoose');

// One row per (poll cycle x Lead Gen Form) fetch — the audit trail + retry
// queue for linkedinLeadPoller.js, LinkedIn's parallel to
// FacebookWebhookLog.js. LinkedIn has no lead webhook, so where a
// FacebookWebhookLog row records one inbound leadgen event, a
// LinkedInLeadSyncLog row records one outbound poll's fetch against one
// form — this IS the primary lead-capture record for LinkedIn, not just a
// failure log. Never store access tokens in `rawResponse`.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  adAccountId: String,
  organizationId: String,
  formId: String, // LinkedIn Lead Gen Form URN, e.g. urn:li:leadGenForm:...
  formName: String,
  campaignId: { type: mongoose.Schema.ObjectId, ref: 'LinkedInCampaign' },

  // The submittedAtAfter lower bound this fetch used, and the fetch results.
  pollWindowStart: Date,
  responsesFetched: { type: Number, default: 0 },
  leadsCreated: { type: Number, default: 0 },
  leadsSkipped: { type: Number, default: 0 }, // already-imported responses (duplicate linkedinLeadId)

  rawResponse: mongoose.Schema.Types.Mixed,

  processingStatus: {
    type: String,
    enum: ['received', 'processing', 'processed', 'failed', 'retrying'],
    default: 'received',
  },
  errorMessage: String,
  retryCount: { type: Number, default: 0 },
  nextRetryAt: Date,

  created: {
    type: Date,
    default: Date.now,
  },
  processedAt: Date,
});

module.exports = mongoose.model('LinkedInLeadSyncLog', schema);
