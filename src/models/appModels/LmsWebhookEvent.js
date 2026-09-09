const mongoose = require('mongoose');

// Every event POSTed to /api/lms/webhook/moodle by local_crmbridge, stored
// before processing. `eventId` (monotonic id from Moodle) is unique, so a
// re-delivery is recognised and skipped. Failed rows are retried by
// jobs/lmsSyncTick.js up to LMS_SYNC_MAX_ATTEMPTS, then marked `dead`.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  eventId: { type: String, required: true, unique: true },
  eventName: { type: String, required: true }, // e.g. \core\event\course_completed
  signatureNonce: { type: String },
  payload: { type: mongoose.Schema.Types.Mixed },

  status: {
    type: String,
    enum: ['received', 'processed', 'skipped', 'failed', 'dead'],
    default: 'received',
  },
  attempts: { type: Number, default: 0 },
  lastError: { type: String },
  nextRetryAt: { type: Date },

  receivedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
});

schema.index({ status: 1, nextRetryAt: 1 });
schema.index({ eventName: 1, receivedAt: -1 });

module.exports = mongoose.model('LmsWebhookEvent', schema);
