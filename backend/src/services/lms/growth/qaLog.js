const mongoose = require('mongoose');

// Error monitoring for Figma 4E: every 500 an API returns is written to
// LmsQaLog (best-effort, max 60 a minute, never throws).
let minute = 0;
let count = 0;

function logError(req, error, controller) {
  try {
    const m = Math.floor(Date.now() / 60000);
    if (m !== minute) {
      minute = m;
      count = 0;
    }
    if (++count > 60) return;
    const path = req && req.originalUrl ? String(req.originalUrl).split('?')[0].replace(/[0-9a-f]{24}/gi, ':id') : '';
    const msg = String((error && error.message) || error || 'error').slice(0, 400);
    mongoose
      .model('LmsQaLog')
      .create({
        level: 'ERROR',
        source: 'server',
        message: `${req ? req.method : ''} ${path} 500 · ${msg}`,
        key: `${req ? req.method : ''} ${path} · ${(error && error.name) || 'Error'}`.slice(0, 160),
        method: req && req.method,
        path,
        host: require('os').hostname(),
        ...(controller ? {} : {}),
      })
      .catch(() => {});
  } catch (_) {
    /* never break the response */
  }
}

function log(level, message, extra = {}) {
  try {
    return mongoose
      .model('LmsQaLog')
      .create({ level, message: String(message).slice(0, 500), source: extra.source || 'qa', run: extra.run, key: extra.key, host: require('os').hostname() })
      .catch(() => {});
  } catch (_) {
    return Promise.resolve();
  }
}

module.exports = { logError, log };
