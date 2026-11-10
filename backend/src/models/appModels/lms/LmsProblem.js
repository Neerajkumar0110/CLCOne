const mongoose = require('mongoose');

// Spec §13.4 problem record (PRB): one underlying cause behind several
// learner tickets (e.g. "BBB join fails on Safari"). Tickets point at it
// (Ticket.problem); resolving the problem resolves every linked open ticket
// with the same answer and tells each learner, who can still confirm or
// reopen their own ticket as before.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  code: { type: String, index: true }, // PRB-0001
  title: { type: String, required: true },
  category: String,
  status: { type: String, enum: ['Open', 'Known error', 'Resolved'], default: 'Open', index: true },
  rootCause: String,
  workaround: String,
  resolution: String,
  owner: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  ownerName: String,
  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  createdByName: String,
  resolvedAt: Date,
  resolvedByName: String,
  history: { type: [{ _id: false, at: Date, byName: String, note: String }], default: [] },
  created: { type: Date, default: Date.now, index: true },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsProblem', schema);
