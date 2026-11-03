const mongoose = require('mongoose');

// Small keyed config rows for the LMS admin screens (design A1/A4/A8/A11):
// 'decisions' (decision register D-01…D-15), 'automation' (paused rules),
// 'rules-proposal' (proposed readiness/assessment/attendance values),
// 'roles:<Role>' (LMS permission matrix draft + approved copy). Every change
// appends to `history` so nothing is silently overwritten.
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  updatedByName: String,
  history: [
    {
      at: Date,
      byName: String,
      note: String,
      value: mongoose.Schema.Types.Mixed,
    },
  ],
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsAdminConfig', schema);
