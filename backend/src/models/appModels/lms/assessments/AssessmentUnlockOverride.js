const mongoose = require('mongoose');

// Manual bypass of the curriculum-delivery unlock gate (see
// services/lms/curriculumTracker.js's UNLOCK_THRESHOLD_PCT, enforced in
// assessments/testController.js#startTest) — requested by Vishakha + team
// during LMS review: a batch can have a scheduled NLP assessment before its
// tracked curriculum-delivery % has actually crossed the test's threshold
// (e.g. delivery records lagging real teaching), which blocked every
// candidate with no way around it except lowering the threshold for
// everyone. This lets a manager open the gate for just one batch, or just
// specific learners, ahead of a scheduled assessment — the % threshold
// itself stays the same for everyone else.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  testType: { type: String, enum: ['BASIC', 'MAJOR', 'MICRO', 'NLP_MICRO', 'NLP_MAJOR'], required: true },
  scope: { type: String, enum: ['batch', 'student'], required: true },

  batch: { type: String }, // set when scope === 'batch'
  student: { type: mongoose.Schema.ObjectId, ref: 'Admin' }, // set when scope === 'student'
  studentName: String,
  studentEmail: String,

  note: String,

  grantedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  grantedByName: String,
  created: { type: Date, default: Date.now },

  revokedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  revokedByName: String,
  revokedAt: Date,
});

schema.index({ testType: 1, batch: 1, removed: 1 });
schema.index({ testType: 1, student: 1, removed: 1 });

module.exports = mongoose.model('AssessmentUnlockOverride', schema);
