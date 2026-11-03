const mongoose = require('mongoose');

// The onboarding steps a learner ticks off themselves (design L10) — every
// other step on the checklist is derived from real records (policies,
// roster, assessment attempts) in lmsController/onboarding.js.
const schema = new mongoose.Schema({
  student: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, unique: true },
  calendarAt: Date,
  setupAt: Date,
  deviceAt: Date,
  // what the in-browser device check found (camera / mic / browser)
  device: { camera: Boolean, microphone: Boolean, browser: String },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('OnboardingProgress', schema);
