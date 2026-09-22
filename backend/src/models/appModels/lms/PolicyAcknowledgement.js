const mongoose = require('mongoose');

// One row per (policy version, student) — created (status 'pending') when a
// PolicyDocument is published to its resolved roster, flipped to
// 'acknowledged' when the student e-signs. A new version of the same policy
// gets its own PolicyDocument + a fresh set of these rows, so history of
// exactly which version a learner acknowledged is never overwritten.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  policy: { type: mongoose.Schema.ObjectId, ref: 'PolicyDocument', required: true, index: true },
  policySlug: String,
  policyTitle: String,
  policyVersion: Number,

  student: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  studentName: String,
  studentEmail: String,

  status: { type: String, enum: ['pending', 'acknowledged'], default: 'pending', index: true },
  acknowledgedAt: Date,
  // Only captured on the acknowledge action itself (not general browsing) —
  // spec §12: "IP/device metadata only if legally appropriate".
  ip: String,
  deviceInfo: String,

  remindedCount: { type: Number, default: 0 },
  lastReminderAt: Date,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ policy: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('PolicyAcknowledgement', schema);
