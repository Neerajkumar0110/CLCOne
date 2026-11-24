const mongoose = require('mongoose');

// Feature flags (Figma 4E): on in QA first, then rolled out to a % of users
// or one batch in production. Read through services/lms/growth/flags.js.
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // learner_360_v2
  description: String,
  qa: { type: Boolean, default: true },
  rollout: { type: Number, default: 0 }, // % of production users (0–100)
  audience: { type: String, default: 'all' }, // all | role:<Role> | batch:<name>
  removed: { type: Boolean, default: false },
  updatedBy: String,
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsFeatureFlag', schema);
