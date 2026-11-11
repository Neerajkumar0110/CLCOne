const mongoose = require('mongoose');

// One row per (custom email, occurrence, recipient) the scheduler already
// sent — so an event-based email (e.g. "2 days after enrolment", "1 hour
// before each class") goes out exactly once per learner / class.
const schema = new mongoose.Schema({
  key: { type: String, required: true },
  ref: { type: String, required: true }, // e.g. "<sessionId>:<email>" / "<email>" / "<YYYY-MM-DD>:<email>"
  at: { type: Date, default: Date.now },
});

schema.index({ key: 1, ref: 1 }, { unique: true });
schema.index({ at: 1 }, { expireAfterSeconds: 400 * 24 * 3600 });

module.exports = mongoose.model('EmailTemplateSend', schema);
