const mongoose = require('mongoose');

// Release pipeline (Figma 4A / 4D): Dev → QA → Production with quality
// gates, sign-off and rollback history.
const schema = new mongoose.Schema({
  version: { type: String, required: true, unique: true }, // e.g. v2.14.0-rc.2
  title: String, // what's in it
  commit: String,
  branch: String,
  env: { type: String, enum: ['dev', 'qa', 'prod', 'superseded', 'rolled_back'], default: 'dev', index: true },
  status: { type: String, enum: ['building', 'in_qa', 'signed_off', 'live', 'rolled_back', 'superseded', 'sent_back'], default: 'building' },
  url: String,
  checklist: { type: Number, default: 0 }, // manual regression cases
  checklistDone: { type: Boolean, default: false },
  signoffs: [{ role: String, name: String, by: { type: mongoose.Schema.ObjectId, ref: 'Admin' }, decision: String, at: Date, note: String, _id: false }],
  history: [{ at: Date, env: String, text: String, by: String, _id: false }],
  deployedQaAt: Date,
  liveAt: Date,
  rolledBackAt: Date,
  createdBy: String,
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsRelease', schema);
