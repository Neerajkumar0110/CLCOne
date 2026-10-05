const mongoose = require('mongoose');

// Live per-agent call-center presence. One doc per Admin, upserted by the
// calling controllers / mock tick. Read by the Auto Dialer + Dashboard.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  agent: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, unique: true },
  agentName: String,

  status: {
    type: String,
    enum: ['Offline', 'Available', 'Ringing', 'OnCall', 'Wrapup', 'Paused'],
    default: 'Offline',
    index: true,
  },
  campaign: { type: mongoose.Schema.ObjectId, ref: 'CallCampaign' },
  currentCall: { type: mongoose.Schema.ObjectId, ref: 'CallRecord' },

  since: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },

  callsToday: { type: Number, default: 0 },
  talkSecondsToday: { type: Number, default: 0 },

  // Instant Lead Pool shift tracking (see config/shiftSchedule.js +
  // leadPool.js) — all best-effort, reset whenever the agent (re)joins on a
  // new IST calendar day.
  shiftJoinedAt: { type: Date }, // when they joined the pool today, for worked-hours math
  breakMinutesToday: { type: Number, default: 0 }, // sum of break durations taken today
  breaksTakenToday: { type: [String], default: [] }, // shiftSchedule break `key`s already used today — one per day each
  pausedUntil: { type: Date }, // on a break: auto-resumes to Available once this passes (see CloudCallProvider.tick)
  breakKey: { type: String }, // which shiftSchedule break is currently active, while Paused for one

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('AgentCallState', schema);
