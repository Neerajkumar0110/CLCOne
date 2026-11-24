const mongoose = require('mongoose');

// Bug tracker linked to releases (Figma 4D). A release can't be promoted
// while it has open Critical / High bugs.
const schema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // BUG-431
  title: { type: String, required: true },
  description: String,
  severity: { type: String, enum: ['Critical', 'High', 'Medium', 'Low'], default: 'Medium', index: true },
  module: String,
  release: { type: String, index: true }, // found in
  fixedIn: String,
  status: { type: String, enum: ['open', 'in_progress', 'fixed', 'verified'], default: 'open', index: true },
  assignee: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  assigneeName: String,
  reporterName: String,
  testCase: String,
  history: [{ at: Date, by: String, from: String, to: String, _id: false }],
  removed: { type: Boolean, default: false },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsBug', schema);
