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

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('AgentCallState', schema);
