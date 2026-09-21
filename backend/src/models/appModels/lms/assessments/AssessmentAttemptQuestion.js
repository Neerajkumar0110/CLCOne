const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

// Ported from python-test-platform (Prisma model `AttemptQuestion`) — one row
// per question assigned to one attempt, holding the candidate's answer.
const schema = new mongoose.Schema({
  _id: { type: String, default: () => randomUUID() },
  attemptId: { type: String, required: true, index: true },
  questionId: { type: String, required: true },
  order: { type: Number, required: true },
  selectedOption: { type: Number },
  submittedCode: { type: String },
  isCorrect: { type: Boolean },
});

module.exports = mongoose.model('AssessmentAttemptQuestion', schema);
