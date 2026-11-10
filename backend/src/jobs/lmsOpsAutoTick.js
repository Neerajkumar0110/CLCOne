// Hourly LMS ops automation (design A8 catalogue, rule "duplicate-class"):
// finds duplicate classes (DATA-02 — same batch, same day, overlapping time
// or same title, not started) in the next 45 days and raises ONE removal
// request per batch, listing every extra class, to the Ops approvals queue
// (two approvers when it is more than one class). Nothing is removed until
// it is approved; then approvalExecutor removes the classes that are still
// duplicates. A class Ops kept (rejected) is never raised again. Wrapped so
// a bad tick never crashes the process (same shape as
// jobs/lmsPolicyReminderTick.js).
const TICK_MS = Number(process.env.LMS_OPS_AUTO_TICK_MS || 60 * 60 * 1000);

async function tick() {
  require('../services/lms/health').ping('lmsOpsAutoTick');
  if (await require('../services/lms/automation').isPaused('duplicate-class')) return { paused: true };
  const out = { raised: 0, classes: 0 };
  try {
    const made = await require('../services/lms/duplicateClasses').raiseAll({ to: new Date(Date.now() + 45 * 86400000) });
    out.raised = made.length;
    out.classes = made.reduce((n, r) => n + r.count, 0);
    if (out.raised) console.log(`[lms] ops auto: ${out.raised} removal request(s) raised for ${out.classes} duplicate class(es)`);
  } catch (e) {
    console.error('[lms] ops auto tick failed:', e.message);
  }
  return out;
}

function start() {
  console.log(`[lms] ops automation tick every ${Math.round(TICK_MS / 60000)} min (duplicate classes)`);
  setTimeout(tick, 5 * 60 * 1000); // let the server settle first
  setInterval(tick, TICK_MS);
}

start.runOnce = tick;
module.exports = start;
