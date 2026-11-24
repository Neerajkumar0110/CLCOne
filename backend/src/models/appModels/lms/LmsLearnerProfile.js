const mongoose = require('mongoose');

// Learner 360° profile block (Figma 1A): what the roster doesn't hold —
// skills, links, education, resume, photo. One row per learner login.
const schema = new mongoose.Schema({
  crmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, unique: true },
  email: { type: String, index: true },
  photoUrl: String,
  city: String,
  education: { degree: String, year: String, institute: String, grade: String },
  skills: [String],
  links: { github: String, linkedin: String, portfolio: String },
  resume: { url: String, name: String, size: Number, updatedAt: Date },
  // 3A "Today's goal" — the learner's own practice settings (null = admin default)
  practice: { goalMin: Number, remindHour: Number, remind: Boolean, streakAlert: Boolean, lastRemindedDay: String, lastStreakAlertDay: String, lastWeeklyWeek: String },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsLearnerProfile', schema);
