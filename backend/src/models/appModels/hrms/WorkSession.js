const mongoose = require('mongoose');

// One row per user per IST working day — the header "Login" button's shift
// (services/hr/workday.js). Separate from LoginActivity (which tracks open
// CRM tabs): this is the user saying "I've started work", and it's what turns
// their auto-dialer on. autoStartedAt is set when the 11:00 job started the
// dialer for someone who hadn't logged in (jobs/workdayTick.js).
const breakSchema = new mongoose.Schema(
  {
    key: String, // shiftSchedule break key (tea-morning / lunch / tea-evening)
    label: String,
    plannedMin: Number,
    startAt: Date,
    endAt: Date, // null while on it
  },
  { _id: false }
);

const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  adminName: String,
  role: String,
  dayKey: { type: String, required: true }, // YYYY-MM-DD, IST
  loginAt: Date,
  logoutAt: Date,
  autoStartedAt: Date,
  startSource: { type: String, enum: ['login', 'auto', 'manager'] },
  // Management marked the day present from Sales 360° (no Login was pressed,
  // the dialer was on / calls were made) — loginAt is then set to when the
  // dialer first came on. Such a day is never turned into a half day.
  markedPresentBy: String,
  markedPresentAt: Date,
  // The "you didn't log out" email went out (jobs/workdayTick.js).
  logoutReminderAt: Date,
  breaks: { type: [breakSchema], default: [] },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ admin: 1, dayKey: 1 }, { unique: true });
schema.index({ dayKey: 1 });

module.exports = mongoose.model('WorkSession', schema);
