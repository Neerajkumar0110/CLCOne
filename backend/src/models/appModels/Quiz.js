const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  course: { type: mongoose.Schema.ObjectId, ref: 'Course', required: true, index: true },
  module: { type: mongoose.Schema.ObjectId, ref: 'CourseModule' },
  lesson: { type: mongoose.Schema.ObjectId, ref: 'Lesson' },
  batch: { type: String },

  teacherCrmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', index: true },
  teacherName: { type: String },

  title: { type: String, required: true },
  description: { type: String },
  type: { type: String, enum: ['quiz', 'exam'], default: 'quiz' },

  timeLimitMin: { type: Number, default: 0 },          // 0 = no limit
  totalQuestions: { type: Number, default: 0 },        // 0 = use all
  randomizeQuestions: { type: Boolean, default: false },
  randomizeOptions: { type: Boolean, default: false },
  passingPercent: { type: Number, default: 40 },
  negativeMarking: { type: Boolean, default: false },
  negativeMarkPerWrong: { type: Number, default: 0 },
  attemptsAllowed: { type: Number, default: 1 },
  instantResult: { type: Boolean, default: true },
  showAnswers: { type: Boolean, default: true },       // reveal correct answers in the result
  manualEvaluation: { type: Boolean, default: false }, // true when it has long/short questions

  startAt: { type: Date },
  endAt: { type: Date },
  published: { type: Boolean, default: true },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ course: 1, published: 1 });

module.exports = mongoose.model('Quiz', schema);
