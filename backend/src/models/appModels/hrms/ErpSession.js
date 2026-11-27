const mongoose = require('mongoose');

// Attendance ERP (HRMS › Work & Leave Tracker › Attendance ERP + /employee
// portal) — one row per employee per IST day. Login / logout come from the
// CRM login itself (issueSession) or the portal; presence comes from the
// heartbeat (browser tracker + CLC Desktop Agent) and is turned into
// ErpActivity periods by services/hr/erpAttendance.js. Only "was the mouse /
// keyboard used" is ever stored — never keys, text or screens.
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  adminName: String,
  role: String,
  dayKey: { type: String, required: true }, // YYYY-MM-DD IST
  loginAt: Date,
  logoutAt: Date,
  logoutType: { type: String, enum: ['manual', 'auth', 'admin', 'auto', null] },
  startSource: { type: String, enum: ['login', 'portal', 'activity', 'manual'] },
  lastActivityAt: Date, // last mouse / keyboard / touch / scroll (any source)
  lastHeartbeatAt: Date, // last beat from any tab or the agent
  lastKbAt: Date,
  lastMouseAt: Date,
  status: { type: String, enum: ['active', 'inactive', 'lunch', 'break', 'offline', 'logged_out', 'needs_review'], default: 'active' },
  // open lunch / break
  currentBreak: { kind: String, key: String, label: String, startAt: Date, plannedEndAt: Date },
  breaksTaken: { type: [String], default: [] }, // keys of lunch / breaks already used today
  device: { browser: String, os: String, ua: String },
  // 10-minute slot ("HH:MM") → beats with keyboard / mouse input (heatmap, keyboard / mouse minutes)
  slots: { type: mongoose.Schema.Types.Mixed, default: {} },
  manual: { type: Boolean, default: false }, // created / edited by an admin
  statusOverride: String, // admin set the day's status by hand (Attendance › correction)
  reviewNote: String, // employee's note on a session that needed review
  reviewedBy: String,
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ admin: 1, dayKey: 1 }, { unique: true });
schema.index({ dayKey: 1, status: 1 });

module.exports = mongoose.model('ErpSession', schema);
