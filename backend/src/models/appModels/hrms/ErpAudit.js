const mongoose = require('mongoose');

// Attendance ERP audit log — every manual change by an admin (correction,
// manual attendance, leave decision, status / balance / setting change,
// "count as work"). Read-only: no API updates or deletes these rows.
const schema = new mongoose.Schema({
  actor: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  actorName: String,
  action: { type: String, required: true },
  employee: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  employeeName: String,
  oldValue: String,
  newValue: String,
  reason: String,
  dayKey: String, // the attendance day it is about, when there is one
  at: { type: Date, default: Date.now },
});

schema.index({ at: -1 });
schema.index({ employee: 1, at: -1 });

module.exports = mongoose.model('ErpAudit', schema);
