const mongoose = require('mongoose');

// CLC-POL-001 section 10: one row per callback / demo / follow-up that passed
// its time. Written by services/sales/overdueTasks.js, so a day's count stays
// on record after the lead moves on.
//   open → explained (the user gave a reason) → excluded (outside their
//   control) | recorded (counted in a short-leave event)
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  adminName: String,
  lead: { type: mongoose.Schema.ObjectId, ref: 'Lead', required: true },
  leadName: String,
  phone: String,
  kind: { type: String, enum: ['callback', 'demo', 'followup'], required: true },
  dueAt: { type: Date, required: true },
  dayKey: { type: String, required: true }, // the IST day it was due
  status: { type: String, enum: ['open', 'explained', 'excluded', 'recorded'], default: 'open' },
  explanation: String,
  reviewedByName: String,
  reviewNote: String,
  created: { type: Date, default: Date.now },
});

schema.index({ admin: 1, lead: 1, kind: 1, dueAt: 1 }, { unique: true });
schema.index({ dayKey: 1, admin: 1 });

module.exports = mongoose.model('OverdueTask', schema);
