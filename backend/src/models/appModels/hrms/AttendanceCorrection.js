const mongoose = require('mongoose');

// CLC-POL-001 section 14: a manual attendance correction keeps the original
// entry, the revised entry, who asked, who approved and when. Append-only —
// a later correction for the same day wins, the earlier ones stay as history.
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  adminName: String,
  dayKey: { type: String, required: true }, // YYYY-MM-DD, IST
  originalStatus: String,
  originalShortLeave: Number,
  revisedStatus: { type: String, enum: ['present', 'half-day', 'absent', 'leave'] },
  // Short-leave events on the day after this correction (a dialer / break
  // event cleared after review, or overdue-task events recorded after review).
  revisedShortLeave: Number,
  reason: { type: String, required: true },
  requestedBy: String,
  approvedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  approvedByName: String,
  created: { type: Date, default: Date.now },
});

schema.index({ admin: 1, dayKey: 1, created: -1 });
schema.index({ dayKey: 1 });

module.exports = mongoose.model('AttendanceCorrection', schema);
