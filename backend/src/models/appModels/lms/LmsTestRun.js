const mongoose = require('mongoose');

// One run of the built-in automated suites (Figma 4C "Run #223 report").
const schema = new mongoose.Schema({
  number: { type: Number, required: true, unique: true },
  release: String,
  trigger: { type: String, default: 'manual' }, // manual | deploy
  by: String,
  status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
  startedAt: { type: Date, default: Date.now },
  finishedAt: Date,
  durationMs: Number,
  suites: {
    unit: { total: Number, passed: Number, failed: Number, flaky: Number, ms: Number },
    integration: { total: Number, passed: Number, failed: Number, flaky: Number, ms: Number },
    e2e: { total: Number, passed: Number, failed: Number, flaky: Number, ms: Number },
    load: { users: Number, requests: Number, p95: Number, errorPct: Number, ms: Number },
  },
  results: [{ id: String, suite: String, name: String, ok: Boolean, flaky: Boolean, ms: Number, error: String, _id: false }],
  coverage: Number, // % of checks with a linked test case
});

module.exports = mongoose.model('LmsTestRun', schema);
