const mongoose = require('mongoose');

// One row per (student, course) — rolled up from LessonProgress whenever a
// lesson's progress is written. Powers the course card % and the dashboards.
const schema = new mongoose.Schema({
  crmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  course: { type: mongoose.Schema.ObjectId, ref: 'Course', required: true, index: true },

  totalLessons: { type: Number, default: 0 },
  completedLessons: { type: Number, default: 0 },
  startedLessons: { type: Number, default: 0 },
  percent: { type: Number, default: 0 },
  lastLesson: { type: mongoose.Schema.ObjectId, ref: 'Lesson' },
  lastActivityAt: { type: Date },
  completedAt: { type: Date },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ crmUser: 1, course: 1 }, { unique: true });

module.exports = mongoose.model('CourseProgress', schema);
