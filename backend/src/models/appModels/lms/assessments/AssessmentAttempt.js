const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

// Ported from python-test-platform (Prisma model `TestAttempt`). Unlike the
// reference project, auth here is the CRM's own bearer auth (Admin), not a
// separate User/JWT table — so instead of a userId FK we keep an optional
// `candidate` ref (set for attempts started live through this CRM) plus
// denormalized candidate fields (set from req.admin for live attempts, or
// carried over as-is from the old Postgres `User` row for imported historical
// attempts, which have no matching Admin account). AttemptsAdmin's
// name/email/batch search and Results' self-scoping both read the
// denormalized fields directly, so neither needs a join back to a User table
// that no longer exists.
const schema = new mongoose.Schema({
  _id: { type: String, default: () => randomUUID() },
  testType: { type: String, enum: ['BASIC', 'MAJOR', 'MICRO', 'NLP_MICRO', 'NLP_MAJOR'], required: true },
  status: { type: String, enum: ['IN_PROGRESS', 'SUBMITTED', 'SUSPENDED'], default: 'IN_PROGRESS' },
  score: { type: Number },
  totalCount: { type: Number },
  warningCount: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now },
  submittedAt: { type: Date },

  candidate: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  candidateName: { type: String },
  candidateEmail: { type: String },
  candidateBatch: { type: String },
});

schema.index({ candidate: 1 });
schema.index({ candidateEmail: 1 });
schema.index({ testType: 1, status: 1 });
schema.index({ startedAt: -1 });

module.exports = mongoose.model('AssessmentAttempt', schema);
