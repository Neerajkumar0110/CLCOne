const mongoose = require('mongoose');

// Hire-readiness snapshot per learner per ISO week (Figma 1A "Progress over
// time", 1B leaderboard). `week` = Monday of that week, 'YYYY-MM-DD'. The
// current week's row is overwritten on every recalculation; past weeks are
// computed from the data as it stood at that week's end.
const schema = new mongoose.Schema({
  crmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  batch: { type: String, index: true },
  week: { type: String, required: true },
  total: Number,
  attendance: Number,
  assessment: Number,
  coding: Number,
  project: Number,
  engagement: Number,
  // the latest component change seen by a recalculation (1A "Live update")
  lastChange: { component: String, from: Number, to: Number, at: Date, note: String },
  computedAt: { type: Date, default: Date.now },
});

schema.index({ crmUser: 1, week: 1 }, { unique: true });
schema.index({ batch: 1, week: 1 });

module.exports = mongoose.model('LmsScoreSnapshot', schema);
