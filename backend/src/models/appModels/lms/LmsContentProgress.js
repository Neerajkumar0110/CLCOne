const mongoose = require('mongoose');

// Content reading progress (Figma 3B): one row per learner per item they
// opened — study material / lesson pages (scroll depth, reading time) and
// videos / recordings (watch %, pauses, rewatches).
const schema = new mongoose.Schema({
  crmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  kind: { type: String, enum: ['lesson', 'material', 'video', 'recording'], required: true },
  ref: { type: String, required: true },
  title: String,
  course: String,
  module: String,
  opens: { type: Number, default: 0 },
  activeSec: { type: Number, default: 0 },
  scrollDepth: { type: Number, default: 0 }, // max % reached
  readPct: { type: Number, default: 0 }, // reading completion %
  durationSec: Number, // video length
  watchedSec: { type: Number, default: 0 }, // distinct seconds watched
  watchedMap: { type: String, default: '' }, // one char per 10-second bucket: 1 = watched
  videoPct: { type: Number, default: 0 },
  pauses: { type: Number, default: 0 },
  rewatches: { type: Number, default: 0 },
  completed: { type: Boolean, default: false },
  completedAt: Date,
  firstAt: { type: Date, default: Date.now },
  lastAt: { type: Date, default: Date.now },
});

schema.index({ crmUser: 1, kind: 1, ref: 1 }, { unique: true });
schema.index({ crmUser: 1, lastAt: -1 });

module.exports = mongoose.model('LmsContentProgress', schema);
