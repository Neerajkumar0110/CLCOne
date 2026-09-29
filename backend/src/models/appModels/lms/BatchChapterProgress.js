const mongoose = require('mongoose');

// Per-batch delivery status for the NATIVE Course -> CourseModule -> Chapter
// -> Lesson curriculum builder (see CurriculumViewer.jsx's "Full Curriculum"
// modal). Distinct from AssessmentDeliveryRecord, which tracks the separate
// ported "proctored assessment" curriculum — this one is keyed by real
// Chapter documents and is what powers the completion checkmarks a student/
// teacher sees in Course Builder and the LMS Calendar. Written by
// services/lms/chapterProgress.js#autoAdvance, one row per (batch, chapter),
// only once that chapter has actually been covered by a completed class.
const schema = new mongoose.Schema({
  batch: { type: mongoose.Schema.ObjectId, ref: 'Batch', required: true, index: true },
  batchName: String,
  course: { type: mongoose.Schema.ObjectId, ref: 'Course', index: true },
  module: { type: mongoose.Schema.ObjectId, ref: 'CourseModule' },
  chapter: { type: mongoose.Schema.ObjectId, ref: 'Chapter', required: true, index: true },

  status: { type: String, enum: ['PENDING', 'DELIVERED'], default: 'DELIVERED' },
  completedAt: { type: Date },
  // The specific class whose real, actually-held hours covered this chapter
  // — lets the Calendar show "today's topic" per class day.
  sessionId: { type: mongoose.Schema.ObjectId, ref: 'LmsLiveSession' },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ batch: 1, chapter: 1 }, { unique: true });
schema.index({ sessionId: 1 });

module.exports = mongoose.model('BatchChapterProgress', schema);
