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
  // Set once, at submission time, from the qualifyThreshold effective THEN
  // (assessmentSettingsService) — spec §10 "automatic final status ... without
  // manual admin intervention". Previously there was no stored outcome field
  // at all: every reader (testController.js/adminController.js, 3 separate
  // call sites) independently recomputed score/totalCount >= a hardcoded
  // constant on every read, so a future admin changing the pass mark would
  // silently reclassify every past attempt, and any new consumer that reads
  // AssessmentAttempt directly (certificate issuance, a report) without
  // reapplying that exact formula would see no qualification signal at all.
  // null = not yet decided (IN_PROGRESS) or SUSPENDED (never reached a score).
  qualified: { type: Boolean, default: null },
  warningCount: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now },
  submittedAt: { type: Date },

  candidate: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  candidateName: { type: String },
  candidateEmail: { type: String },
  candidateBatch: { type: String },

  // Manual review/correction (spec §9 "Manual review and result correction
  // must require authorization and an audit trail") — previously there was
  // no way to fix a score/qualification after the fact through any API at
  // all (the attendance engine has correctAttendance; assessments had no
  // equivalent). See adminController.js#correctAttempt.
  correctedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  correctedByName: { type: String },
  correctedAt: { type: Date },
  correctedReason: { type: String },
});

schema.index({ candidate: 1 });
schema.index({ candidateEmail: 1 });
schema.index({ testType: 1, status: 1 });
schema.index({ startedAt: -1 });
// Closes the TOCTOU race in testController.js#startTest: the "no existing
// IN_PROGRESS attempt" check and the AssessmentAttempt.create() call are a
// plain read then a separate write, with no transaction/lock between them —
// two concurrent startTest requests for the same candidate+testType could
// both pass the check before either insert landed. A partial unique index
// makes the second insert fail at the DB level instead, regardless of
// request timing; startTest catches the E11000 and returns the same 409 the
// read-based check already returns for the non-racing case.
schema.index({ candidate: 1, testType: 1 }, { unique: true, partialFilterExpression: { status: 'IN_PROGRESS' } });

module.exports = mongoose.model('AssessmentAttempt', schema);
