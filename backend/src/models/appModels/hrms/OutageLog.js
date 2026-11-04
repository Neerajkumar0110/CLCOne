const mongoose = require('mongoose');

// CLC-POL-001 section 6.1: technical outages, approved training and official
// meetings are logged and reviewed, not treated as misconduct. Attendance
// credits this time as dialer time and records no automatic short leave.
// No admins = everyone.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  kind: { type: String, enum: ['outage', 'training', 'meeting', 'emergency'], required: true },
  from: { type: Date, required: true },
  to: { type: Date, required: true },
  admins: [{ type: mongoose.Schema.ObjectId, ref: 'Admin' }],
  adminNames: [String],
  reason: { type: String, required: true },
  byName: String,
  created: { type: Date, default: Date.now },
});

schema.index({ from: 1, to: 1 });

module.exports = mongoose.model('OutageLog', schema);
