const mongoose = require('mongoose');

// Test case management (Figma 4C). `check` links a case to an automated
// check of the built-in runner (services/lms/growth/qaRunner.js); a case
// without one is manual and its result is set by QA.
const schema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // TC-1042
  title: { type: String, required: true },
  module: String, // Projects | Learner 360° | Engagement | Performance | …
  type: { type: String, enum: ['Unit', 'Integration', 'E2E', 'Load', 'Manual'], default: 'Manual' },
  priority: { type: String, enum: ['Critical', 'High', 'Medium', 'Low'], default: 'Medium' },
  check: String, // automated check id
  steps: String,
  lastResult: { type: String, enum: ['Passed', 'Failed', 'Flaky', 'Not run'], default: 'Not run' },
  lastRun: Number,
  release: String,
  removed: { type: Boolean, default: false },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsTestCase', schema);
