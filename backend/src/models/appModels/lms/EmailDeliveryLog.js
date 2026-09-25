const mongoose = require('mongoose');

// Per-recipient send outcome for every email that goes through
// services/lms/mailer.js#sendMail (the one shared send path used by LMS
// enrollment/policy/live-class mail AND services/payments/mailer.js's
// payment-link/EMI mail). Spec §8 "delivery logs, sent/failed" — previously
// a failed send was only console.error'd, with nothing queryable anywhere.
// This is not a full bounce-tracking system (Gmail SMTP via an App Password
// has no bounce webhook to hook into — a real infra limitation of that
// provider, not something fixable in code alone), just an honest record of
// what this app actually knows: did the SMTP send itself succeed or fail.
const schema = new mongoose.Schema({
  recipient: { type: String, required: true, index: true },
  subject: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'failed'], required: true, index: true },
  error: { type: String, default: '' },
  sentAt: { type: Date, default: Date.now, index: true },
});

// Bounded — this is an operational log, not a permanent record; 90 days is
// plenty to catch a delivery problem.
schema.index({ sentAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('EmailDeliveryLog', schema);
