const mongoose = require('mongoose');

// One criterion in a course's eligibility policy — fully admin-configurable
// (spec §4: "threshold and weighting must be admin-configurable rather than
// hard-coded"). `key` selects which live metric services/lms/eligibilityEngine
// computes it from (attendance, curriculum, assignment, quiz, surpriseTest,
// acknowledgement, project, proctoredAssessment).
const criterionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: String,
    enabled: { type: Boolean, default: true },
    mandatory: { type: Boolean, default: true }, // hard gate — must pass regardless of weighted score
    minPercent: { type: Number, default: 0 },
    weight: { type: Number, default: 1 }, // contribution to the weighted overall score
  },
  { _id: false }
);

// One rule per course — mirrors CertificateRule's shape/ownership model.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  course: { type: mongoose.Schema.ObjectId, ref: 'Course', required: true, unique: true },
  courseTitle: String,

  criteria: { type: [criterionSchema], default: [] },
  overallThresholdPercent: { type: Number, default: 90 },
  enabled: { type: Boolean, default: true },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('EligibilityRule', schema);
