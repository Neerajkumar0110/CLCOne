const mongoose = require('mongoose');

// One row per (student, lesson). Written from the learning page as the student
// watches / reads; rolled up into CourseProgress.
const schema = new mongoose.Schema({
  crmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  lesson: { type: mongoose.Schema.ObjectId, ref: 'Lesson', required: true, index: true },
  course: { type: mongoose.Schema.ObjectId, ref: 'Course', index: true },
  module: { type: mongoose.Schema.ObjectId, ref: 'CourseModule' },

  status: { type: String, enum: ['not_started', 'started', 'completed'], default: 'not_started' },
  watchedSeconds: { type: Number, default: 0 },
  durationSec: { type: Number, default: 0 },
  percent: { type: Number, default: 0 },        // 0..100
  lastPositionSec: { type: Number, default: 0 },
  // 25 / 50 / 75 / 100 milestone flags (spec: "Started / 25% / 50% / 75% / 100%")
  milestones: {
    started: { type: Boolean, default: false },
    p25: { type: Boolean, default: false },
    p50: { type: Boolean, default: false },
    p75: { type: Boolean, default: false },
    p100: { type: Boolean, default: false },
  },
  completedAt: { type: Date },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ crmUser: 1, lesson: 1 }, { unique: true });
schema.index({ crmUser: 1, course: 1 });

module.exports = mongoose.model('LessonProgress', schema);
