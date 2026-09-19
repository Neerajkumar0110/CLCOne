const mongoose = require('mongoose');

// One question. Also serves as the Question Bank — every question is tied to a
// course, so the builder can filter/reuse across quizzes of the same course.
const QUESTION_TYPES = ['mcq', 'multiple', 'truefalse', 'fill', 'short', 'long'];

const optionSchema = new mongoose.Schema(
  { key: String, text: String, correct: { type: Boolean, default: false } },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  quiz: { type: mongoose.Schema.ObjectId, ref: 'Quiz', index: true },
  course: { type: mongoose.Schema.ObjectId, ref: 'Course', index: true },

  type: { type: String, enum: QUESTION_TYPES, default: 'mcq' },
  text: { type: String, required: true },
  options: { type: [optionSchema], default: [] },       // mcq / multiple / truefalse
  correctText: { type: [String], default: [] },         // fill / short — any match (ci)
  marks: { type: Number, default: 1 },
  explanation: { type: String },
  order: { type: Number, default: 0 },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ quiz: 1, order: 1 });

module.exports = mongoose.model('Question', schema);
module.exports.QUESTION_TYPES = QUESTION_TYPES;
