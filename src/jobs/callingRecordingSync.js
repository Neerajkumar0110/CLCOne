const mongoose = require('mongoose');
const { getProvider, callingConfig } = require('../services/calling');

// Pulls Tata Smartflo's CDR API (provider.syncCdr()) — reconciles call
// status/duration/recording for calls the CRM already knows about, AND
// creates a CallRecord for any call in the CDR the CRM never originated
// (e.g. one placed via direct API testing) so the dashboard reflects
// everything that happened on the Tata account. Same in-process-poller
// shape as callingDialerTick.js. Runs every 3 minutes: Tata's API
// rate-limits aggressively, and this isn't time-critical the way live
// call state is.
const TICK_MS = 3 * 60 * 1000;

function startCallingRecordingSync() {
  if (callingConfig.isMock) return;

  let running = false;
  let quietUntil = 0;
  setInterval(async () => {
    if (running) return;
    if (mongoose.connection.readyState !== 1) return;
    const provider = getProvider();
    if (typeof provider.syncCdr !== 'function') return;
    running = true;
    try {
      await provider.syncCdr();
    } catch (err) {
      if (Date.now() > quietUntil) {
        console.error('callingRecordingSync job error:', err.message);
        quietUntil = Date.now() + 5 * 60 * 1000;
      }
    } finally {
      running = false;
    }
  }, TICK_MS);
}

module.exports = startCallingRecordingSync;
