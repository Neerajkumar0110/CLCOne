const mongoose = require('mongoose');

// One period of an ErpSession: ACTIVE / INACTIVE / LUNCH / BREAK / OFFLINE.
// endAt is null while the period is still running. Actual work = the sum of
// ACTIVE periods (+ INACTIVE ones an admin counted as work). Every INACTIVE
// row is the "5 minutes without keyboard and mouse" record of the Inactivity
// Log — never deleted; an admin can only count it as work, with a reason.
const schema = new mongoose.Schema({
  session: { type: mongoose.Schema.ObjectId, ref: 'ErpSession', required: true },
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  dayKey: { type: String, required: true },
  type: { type: String, enum: ['ACTIVE', 'INACTIVE', 'LUNCH', 'BREAK', 'OFFLINE'], required: true },
  startAt: { type: Date, required: true },
  endAt: Date,
  label: String, // LUNCH / BREAK: "Lunch", "Tea break 1"
  auto: Boolean, // LUNCH / BREAK started on its own at the scheduled time
  // INACTIVE only
  lastInputAt: Date, // last keyboard / mouse input before it (startAt = this + threshold)
  source: { type: String, enum: ['agent', 'browser', 'admin'] },
  laptop: String, // what the laptop was doing (from the agent): "Screen on, unlocked", "Locked 18:35"…
  employeeNote: String,
  countedAsWork: { type: Boolean, default: false },
  countedBy: String,
  countedReason: String,
  countedAt: Date,
  created: { type: Date, default: Date.now },
});

schema.index({ session: 1, startAt: 1 });
schema.index({ admin: 1, dayKey: 1 });
schema.index({ dayKey: 1, type: 1 });

module.exports = mongoose.model('ErpActivity', schema);
