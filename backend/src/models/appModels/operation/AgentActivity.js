const mongoose = require('mongoose');

// Append-only log of a calling user's pool / break events, so the User
// Activity report (services/reports/userActivity.js) can show every pool
// ON/OFF and break of any past day — AgentCallState only ever holds the
// CURRENT state. Written by services/activity/agentActivity.js.
//   pool_on / pool_off — joined / left the Instant Lead Pool (self, a
//                         manager from Team Activity, or the system)
//   break_start / break_end
//   shift_login / shift_logout — header Login / Logout (services/hr/workday.js)
//   auto_start — the 11:00 job put them on the dialer (not logged in)
//   leave_pause — approved leave paused / stopped their dialer
//   leave_applied / leave_decided
const KINDS = ['pool_on', 'pool_off', 'break_start', 'break_end', 'shift_login', 'shift_logout', 'auto_start', 'leave_pause', 'leave_applied', 'leave_decided'];
const schema = new mongoose.Schema({
  agent: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  agentName: String,
  kind: { type: String, enum: KINDS, required: true },
  at: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.ObjectId, ref: 'Admin' }, // who did it (null = system)
  byName: String,
  detail: String,
});

schema.index({ agent: 1, at: -1 });
schema.index({ at: -1 });

module.exports = mongoose.model('AgentActivity', schema);
