const { callingConfig } = require('../../config/calling');
const MockCallingProvider = require('./MockCallingProvider');
const CloudCallProvider = require('./CloudCallProvider');

// Factory — one provider instance per process, chosen by CALLING_PROVIDER.
// Swapping providers is config-only; no controller code changes.
//   mock  → simulation (default)
//   cloud → Plivo
let _provider = null;

// tick() is the dialer's heartbeat and it is called from a lot of places at
// once: the 8s cron job (jobs/callingDialerTick.js) plus every polled read
// endpoint (agent/active, dashboard, history, reports, recordings,
// callbacks) so that a serverless deploy with no cron still makes progress.
// With several agents on screen that is easily a handful of concurrent
// ticks, and two ticks running the pacing loop at the same time used to
// double-spend the same free agent.
//
// reserveAgent() makes that safe at the database level, but there is no
// reason to pay for the duplicated work: collapse concurrent calls into the
// one tick already in flight and hand every caller its result. Callers only
// ever want "make sure state is current before I read", which a tick that
// is already running satisfies.
function singleFlightTick(provider) {
  const run = provider.tick.bind(provider);
  let inFlight = null;
  provider.tick = function tick() {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(run)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
  return provider;
}

function getProvider() {
  if (_provider) return _provider;
  switch (callingConfig.provider) {
    case 'cloud':
      _provider = singleFlightTick(new CloudCallProvider(callingConfig));
      break;
    default:
      _provider = singleFlightTick(new MockCallingProvider(callingConfig));
  }
  return _provider;
}

// What the polled read endpoints call instead of tick(). Where the
// background jobs run (the VPS) the 8 s callingDialerTick job already keeps
// every call / agent state current, so a read doesn't tick at all — before,
// every user's 5 s agent/active poll (on every page) waited for a full tick
// (dozens of Atlas queries), which is what made pages slow to load. With no
// background jobs (serverless, a laptop on the shared DB) or the mock
// provider, reads still drive it as before.
const BACKGROUND_JOBS_ON = String(process.env.RUN_BACKGROUND_JOBS ?? 'true').toLowerCase() !== 'false';
async function readTick() {
  if (BACKGROUND_JOBS_ON && !callingConfig.isMock) return null;
  return getProvider().tick();
}

module.exports = { getProvider, readTick, callingConfig };
