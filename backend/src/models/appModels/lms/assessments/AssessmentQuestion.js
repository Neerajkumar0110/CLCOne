const mongoose = require('mongoose');

// Ported from python-test-platform (Prisma model `Question`). `_id` is kept as the
// original Postgres UUID string so imported AssessmentAttemptQuestion.questionId
// values need no remapping. Prefixed `Assessment*` to avoid colliding with the
// unrelated, already-existing generic quiz system's `Question` model.
const schema = new mongoose.Schema({
  _id: { type: String },
  topic: { type: String, required: true },
  text: { type: String, required: true },
  questionType: { type: String, enum: ['MCQ', 'OUTPUT_BASED', 'PROGRAMMING'], required: true },
  options: { type: [String], default: undefined },
  correctOption: { type: Number },
  expectedOutput: { type: String },
  starterCode: { type: String },
  type: { type: String, enum: ['BASIC', 'MAJOR', 'MICRO', 'NLP_MICRO', 'NLP_MAJOR'], required: true },
  difficulty: { type: String, required: true },
  partOrder: { type: Number, default: 0 },
  retired: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

schema.index({ type: 1, questionType: 1 });

module.exports = mongoose.model('AssessmentQuestion', schema);
