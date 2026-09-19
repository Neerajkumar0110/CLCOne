const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.ObjectId, ref: 'Question' },
    chosen: { type: [String], default: [] },   // option keys for mcq/multiple/truefalse
    text: { type: String },                    // fill/short/long
    awarded: { type: Number, default: 0 },
    correct: { type: Boolean },
    auto: { type: Boolean, default: true },     // false once a teacher scores it
  },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  quiz: { type: mongoose.Schema.ObjectId, ref: 'Quiz', required: true, index: true },
  course: { type: mongoose.Schema.ObjectId, ref: 'Course', index: true },

  student: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  studentName: { type: String },
  studentEmail: { type: String },

  attempt: { type: Number, default: 1 },
  startedAt: { type: Date, default: Date.now },
  submittedAt: { type: Date },
  dueAt: { type: Date },                        // startedAt + timeLimit (for auto-submit)

  answers: { type: [answerSchema], default: [] },
  autoScore: { type: Number, default: 0 },
  manualScore: { type: Number, default: 0 },
  totalScore: { type: Number, default: 0 },
  maxScore: { type: Number, default: 0 },
  percent: { type: Number, default: 0 },
  passed: { type: Boolean, default: false },

  status: { type: String, enum: ['in_progress', 'submitted', 'evaluated'], default: 'in_progress' },
  evaluatedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  evaluatedAt: { type: Date },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ quiz: 1, student: 1, attempt: 1 }, { unique: true });

module.exports = mongoose.model('QuizAttempt', schema);
