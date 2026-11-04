const mongoose = require('mongoose');

// CLC-POL-001 section 4: one row per person per recovery Sunday, always with
// its substitute weekly rest day and the work plan told to them in advance.
// services/hr/workday.js dayOff + the Sales 360° attendance read this.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  adminName: String,
  sundayKey: { type: String, required: true }, // YYYY-MM-DD, IST
  restDayKey: { type: String, required: true }, // the substitute rest day
  plan: { type: String, required: true },
  compensation: String, // overtime or other statutory compensation
  hrChecked: Boolean, // HR confirmed state law and exemptions
  byName: String,
  by: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  created: { type: Date, default: Date.now },
});

schema.index({ admin: 1, sundayKey: 1 }, { unique: true });
schema.index({ admin: 1, restDayKey: 1 });

module.exports = mongoose.model('SundayRoster', schema);
