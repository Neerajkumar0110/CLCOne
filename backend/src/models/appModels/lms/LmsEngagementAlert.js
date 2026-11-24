const mongoose = require('mongoose');

// Engagement alerts (Figma 3C) and the support outreach queue (3D). One row
// per learner per alert episode (`key` is unique, so the laptop and the VPS
// tick can never create it twice). A row resolves itself when the learner is
// active again after it was raised.
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // `${kind}:${learner}:${episode}`
  learner: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  learnerName: String,
  learnerEmail: String,
  learnerPhone: String,
  learnerId: String, // roster enrolment id
  batch: { type: String, index: true },
  mentor: { type: mongoose.Schema.ObjectId, ref: 'Admin', index: true },
  mentorName: String,
  // inactiveMentor | inactiveSupport | lowStreak | missedLive | streakBroken | readinessLow | manual
  kind: { type: String, required: true, index: true },
  text: String,
  severity: { type: String, enum: ['er', 'wa'], default: 'wa' },
  status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
  inactiveDays: Number,
  lastActive: Date,

  // ── 3D outreach (support) ──
  queue: { type: String, enum: [null, 'to_contact', 'follow_up', 'resolved'], default: null, index: true },
  sentToSupportBy: String,
  attempts: { type: Number, default: 0 },
  contacts: [{ at: Date, by: String, channel: String, outcome: String, notes: String, _id: false }],
  lastContactAt: Date,
  lastOutcome: String,
  notes: String,
  followUpAt: Date,
  escalateTo: String,
  dropRisk: { type: Boolean, default: false },
  dropRiskAt: Date,
  reactivatedAt: Date,

  nudges: [{ at: Date, by: String, _id: false }],
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
  resolvedAt: Date,
});

schema.index({ status: 1, created: -1 });

module.exports = mongoose.model('LmsEngagementAlert', schema);
