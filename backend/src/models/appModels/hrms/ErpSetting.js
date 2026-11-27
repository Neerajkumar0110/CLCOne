const mongoose = require('mongoose');

// Attendance ERP settings — one document (key 'main'). Defaults live in
// services/hr/erpAttendance.js (DEFAULTS); nothing is hard-coded elsewhere.
const schema = new mongoose.Schema({
  key: { type: String, default: 'main', unique: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  updated: { type: Date, default: Date.now },
  updatedBy: String,
});

module.exports = mongoose.model('ErpSetting', schema);
