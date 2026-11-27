const mongoose = require('mongoose');

// A laptop running the CLC Desktop Agent (desktop-agent/). The agent reads the
// operating system's own idle time, so keyboard / mouse use in ANY app counts,
// and reports power events (boot, lock, sleep, shutdown). Bound to one
// employee; authenticates with a device token (only its hash is stored).
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  deviceId: { type: String, required: true },
  hostname: String,
  os: String,
  agentVersion: String,
  tokenHash: { type: String, required: true },
  installedAt: { type: Date, default: Date.now },
  lastSeenAt: Date,
  power: { type: String, enum: ['on', 'locked', 'sleep', 'off'], default: 'on' },
  powerSince: Date,
  lastKbAt: Date,
  lastMouseAt: Date,
  lastInputAt: Date,
  idleSec: Number,
  clockSkewSec: Number,
  revoked: { type: Boolean, default: false },
  created: { type: Date, default: Date.now },
});

schema.index({ admin: 1 });
schema.index({ deviceId: 1, admin: 1 }, { unique: true });

module.exports = mongoose.model('ErpDevice', schema);
