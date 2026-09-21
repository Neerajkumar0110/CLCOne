const mongoose = require('mongoose');

// Ported from python-test-platform (Prisma model `RoundRobinCursor`). `_id` is
// `${testType}_${questionType}` (mirrors the reference project's composite
// cursor id). Starts empty — not imported from the historical dump, since the
// old cursor offsets were tied to the old (Postgres) question ordering.
const schema = new mongoose.Schema({
  _id: { type: String },
  testType: { type: String, enum: ['BASIC', 'MAJOR', 'MICRO', 'NLP_MICRO', 'NLP_MAJOR'], required: true },
  questionType: { type: String, enum: ['MCQ', 'OUTPUT_BASED', 'PROGRAMMING'], required: true },
  cursor: { type: Number, default: 0 },
});

module.exports = mongoose.model('AssessmentRoundRobinCursor', schema);
