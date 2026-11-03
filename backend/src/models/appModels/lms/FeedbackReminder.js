const mongoose = require('mongoose');

// How many feedback reminders a learner got for a week (capped by
// MAX_REMINDERS_PER_WEEK in config/lmsFeedback.js).
const schema = new mongoose.Schema({
  student: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  weekKey: { type: String, required: true },
  count: { type: Number, default: 0 },
  lastAt: Date,
});

schema.index({ student: 1, weekKey: 1 }, { unique: true });

module.exports = mongoose.model('FeedbackReminder', schema);
