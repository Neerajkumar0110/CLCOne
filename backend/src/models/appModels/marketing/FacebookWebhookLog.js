const mongoose = require('mongoose');

// One row per Meta leadgen webhook event — the audit trail + retry queue.
// Never store access tokens in `payload`; it's Meta's raw webhook body only.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  pageId: String,
  formId: String,
  leadgenId: String,
  eventType: String, // e.g. "leadgen"

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

module.exports = mongoose.model('FacebookWebhookLog', schema);
