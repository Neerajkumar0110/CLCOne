const mongoose = require('mongoose');
const { getProvider, callingConfig } = require('../services/calling');

// Drives the calling auto-dialer. Same in-process-poller shape as the
// Facebook/Google webhook retry jobs (no queue infra in this app). The
// provider's tick() is idempotent: it auto-dials Available agents on Active
// campaigns, clears stuck calls, and rolls Wrapup → Available.
//
// The read endpoints also call tick() on demand (serverless-safe fallback);
// this job is what makes auto-dial progress when nobody is looking at a screen.
const TICK_MS = 8 * 1000;

function startCallingDialerTick() {
  // Mock already runs its own simulation via the read endpoints; only the
  // real providers benefit from a steady server-side heartbeat.
  if (callingConfig.isMock) return;

  let running = false;
  let quietUntil = 0; // suppress repeat error logs during an outage
  setInterval(async () => {
    if (running) return; // never overlap ticks
    // Skip while the DB isn't connected (e.g. local dev with no internet) —
    // tick() only touches Mongo, so there's nothing to do and every call
    // would just throw. 1 = connected.
    if (mongoose.connection.readyState !== 1) return;
    running = true;
    try {
      await getProvider().tick();
    } catch (err) {
      if (Date.now() > quietUntil) {
        console.error('callingDialerTick job error:', err.message);
        quietUntil = Date.now() + 60 * 1000; // at most one log per minute
      }
    } finally {
      running = false;
    }
  }, TICK_MS);
}

module.exports = startCallingDialerTick;
