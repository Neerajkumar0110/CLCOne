const mongoose = require('mongoose');

// Laptop events from the CLC Desktop Agent: boot, unlock, lock, sleep, wake,
// shutdown, agent_start, agent_stop, clock_skew.
const schema = new mongoose.Schema({
  device: { type: mongoose.Schema.ObjectId, ref: 'ErpDevice', required: true },
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  dayKey: { type: String, required: true },
  at: { type: Date, required: true },
  kind: { type: String, required: true },
  detail: String,
  created: { type: Date, default: Date.now },
});

schema.index({ admin: 1, dayKey: 1, at: 1 });

module.exports = mongoose.model('ErpDeviceEvent', schema);
