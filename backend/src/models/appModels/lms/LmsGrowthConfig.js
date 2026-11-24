const mongoose = require('mongoose');

// LMS Additional Requirements (Figma 1B "360° Scoring Settings" + 3E
// "Engagement rules & scoring"). One row, key = 'live'. Read through
// services/lms/growth/config.js (defaults filled in there).
const weightsSchema = new mongoose.Schema(
  { attendance: Number, assessment: Number, coding: Number, project: Number },
  { _id: false }
);

const schema = new mongoose.Schema({
  key: { type: String, default: 'live', unique: true },

  // ── 1B ──
  weights: weightsSchema, // % — must total 100
  batchWeights: [{ batch: String, weights: weightsSchema, _id: false }], // per-batch override
  levels: { jobReady: Number, almost: Number }, // ≥ jobReady = Job Ready, ≥ almost = Almost Ready
  realtime: { type: Boolean, default: true },
  mentorPdf: { type: Boolean, default: true }, // mentors may download PDFs of assigned learners

  // ── 3E ──
  // free-form (validated in the controller): idleTimeoutMin, active{…},
  // weights{practiceTime, completion, exercises, streak}, levels, dailyGoalMin,
  // reminderHour, quiet{from,to}, streakRisk, weeklyEmail, showIn360, rules{…}
  engagement: { type: mongoose.Schema.Types.Mixed },
  // 4A / 4E QA settings: autoRollback, access{sso, ipAllowlist, noIndex, guests},
  // teams{dev:[names], qa:[names]}
  qa: { type: mongoose.Schema.Types.Mixed },

  updatedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  updatedByName: String,
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsGrowthConfig', schema);
