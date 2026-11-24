const mongoose = require('mongoose');

// QA logs & error monitoring (Figma 4E): server errors (every 500 the API
// returns, rate-limited), test-run output, deploys / promotions / rollbacks.
const schema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  level: { type: String, enum: ['INFO', 'WARN', 'ERROR'], default: 'INFO', index: true },
  source: { type: String, default: 'server' }, // server | test-run | release | qa
  run: { type: Number, index: true }, // test run number
  message: String,
  key: String, // grouping key for "Top errors"
  method: String,
  path: String,
  host: String,
});
schema.index({ at: -1 });
// keep 60 days
schema.index({ at: 1 }, { expireAfterSeconds: 60 * 24 * 3600, name: 'ttl_60d' });

module.exports = mongoose.model('LmsQaLog', schema);
