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
  setInterval(async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await getProvider().tick();
    } catch (err) {
      console.error('callingDialerTick job error:', err.message);
    } finally {
      running = false;
    }
  }, TICK_MS);
}

module.exports = startCallingDialerTick;
