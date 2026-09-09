const mongoose = require('mongoose');

// Durable outbound sync queue (CRM → Moodle). No external queue infra exists
// in this app (see jobs/facebookWebhookRetry.js for the same reasoning), so
// this is a Mongo-backed queue drained by jobs/lmsSyncTick.js.
//
// `dedupeKey` collapses repeated intents (e.g. three quick role changes for
// one user) into a single pending job.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  kind: {
    type: String,
    enum: [
      'user.provision',
      'user.update',
      'user.role',
      'user.suspend',
      'course.mirror',
      'category.mirror',
      'cohort.upsert',
      'cohort.member.add',
      'cohort.member.remove',
      'enrol',
      'unenrol',
    ],
    required: true,
  },
  dedupeKey: { type: String, index: true },
  payload: { type: mongoose.Schema.Types.Mixed },

  status: { type: String, enum: ['pending', 'running', 'done', 'failed', 'dead'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  runAfter: { type: Date, default: Date.now },
  lastError: { type: String },
  result: { type: mongoose.Schema.Types.Mixed },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ status: 1, runAfter: 1 });

module.exports = mongoose.model('LmsSyncJob', schema);
