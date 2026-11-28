const mongoose = require('mongoose');

// HR details the CRM user (Admin) doesn't carry — the employee list of the
// Attendance ERP is the Admin collection itself; this only adds code,
// department, designation, joining date, reporting line and leave balance
// adjustments. One row per Admin, created on first edit.
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, unique: true },
  employeeCode: String,
  department: String,
  designation: String,
  joiningDate: Date,
  shiftName: { type: String, default: 'General' },
  reportsTo: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  erpRole: { type: String, enum: ['employee', 'hr_admin'], default: 'employee' },
  // + / − days on top of the yearly quota, per leave type ({ Casual: 1 })
  leaveAdjust: { type: mongoose.Schema.Types.Mixed, default: {} },
  // "Track attendance" (Employees). Not set = default: everyone except the owner account.
  trackingEnabled: { type: Boolean },
  // CLC Desktop Agent pairing: a short code shown in /employee › Desktop agent,
  // typed into the agent (no login on the laptop, so the browser session stays).
  pairCode: String,
  pairExpires: Date,
  // Last "Attendance ERP login" email (User Management › All Users ✉ / on account create)
  invitedAt: Date,
  invitedBy: String,
  // Desktop agent permission asked on the first portal sign-in (allowed → download)
  agentConsent: { type: String, enum: ['allowed', 'declined'] },
  agentConsentAt: Date,
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ErpProfile', schema);
