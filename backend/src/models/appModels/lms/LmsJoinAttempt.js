const mongoose = require('mongoose');

// One row per step of a live-class join, so "why couldn't this candidate
// join?" has an answer (Candidates → detail modal → Live classes):
//   step 'join'   — Join clicked in the CRM (or the email/calendar link
//                   opened); ok=false carries the reason it was refused
//                   ("class has not started", "not a participant", ...)
//   step 'ticket' — the one-time ticket was redeemed and the browser was
//                   sent on to BigBlueButton; ok=false = expired/invalid link
// Whether they then actually showed up INSIDE BBB is stamped on the
// session's participant row (bbbFirstSeenAt/bbbLastSeenAt) by the live tick.
// Best-effort, write-only log — see services/lms/joinAttemptLog.js.
const schema = new mongoose.Schema({
  session: { type: mongoose.Schema.ObjectId, ref: 'LmsLiveSession', index: true },
  crmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', index: true },
  email: String,
  name: String,
  step: { type: String, enum: ['join', 'ticket'], required: true },
  via: String, // 'app' | 'link' | 'ticket'
  ok: { type: Boolean, required: true },
  errorCode: Number,
  error: String,
  ip: String,
  userAgent: String,
  at: { type: Date, default: Date.now, index: true },
});

schema.index({ crmUser: 1, session: 1, at: -1 });

module.exports = mongoose.model('LmsJoinAttempt', schema);
