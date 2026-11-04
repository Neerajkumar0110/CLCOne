const mongoose = require('mongoose');

// One row per daily email run, so a restart or a second server can't send the
// same day's mail twice (jobs/salesDailyMailTick.js).
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true }, // e.g. prospects:2026-11-04
  at: { type: Date, default: Date.now },
});

module.exports = mongoose.model('DailyMailRun', schema);
