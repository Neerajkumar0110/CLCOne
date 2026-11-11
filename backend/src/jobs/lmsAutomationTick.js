// Runs the 11 spec §17.1 workflows in services/lms/automationRules.js
// (design A8 Automation catalogue) every 10 minutes. Each rule decides for
// itself whether this tick is inside its window (daily at a time, weekly,
// or every run) and is skipped while it is paused on the Automation screen.
// What each run did is kept in LmsAdminConfig 'automation:runs' (last
// result per rule + the last 30 runs) — shown on the Automation screen.
// A failing rule is logged and recorded; it never stops the other rules or
// the process (same contract as the other lms*Tick jobs).
const mongoose = require('mongoose');

const TICK_MS = Number(process.env.LMS_AUTOMATION_TICK_MS || 10 * 60 * 1000);
let running = false;

async function loadCfg(key) {
  const row = await mongoose.model('LmsAdminConfig').findOne({ key }).lean();
  return (row && row.value) || {};
}

async function tick({ only, dry = false, now = new Date() } = {}) {
  if (running) return { skipped: 'previous tick still running' };
  running = true;
  const health = require('../services/lms/health');
  const automation = require('../services/lms/automation');
  const { RUNNERS } = require('../services/lms/automationRules');
  health.ping('lmsAutomationTick');
  const results = {};
  try {
    const state = await loadCfg('automation:state');
    const lastRuns = await loadCfg('automation:runs');
    for (const [key, r] of Object.entries(RUNNERS)) {
      if (only && !only.includes(key)) continue;
      // eslint-disable-next-line no-await-in-loop
      if (!only && (await automation.isPaused(key))) continue;
      const st = state[key] || {};
      if (!only && !r.when(now, st)) continue;
      const started = Date.now();
      let summary;
      let ok = true;
      try {
        // eslint-disable-next-line no-await-in-loop
        summary = await r.run({ dry, now }, st);
        // once-a-day rules: remember the day so later ticks skip it
        if (!dry && r.daily) st.lastDay = require('../services/lms/automationRules')._h.dayKey(now);
      } catch (e) {
        ok = false;
        summary = `failed: ${e.message}`;
        console.error(`[lms] automation ${key} failed:`, e.message);
      }
      state[key] = st;
      health.ping(`auto:${key}`);
      results[key] = { ok, summary, ms: Date.now() - started };
      if (!dry) {
        const value = { ok, summary: String(summary).slice(0, 500), at: new Date() };
        // the run log only gets a line when something changed — an every-10-min
        // rule that keeps finding nothing must not push real runs out of it
        const prev = lastRuns[key];
        const changed = !prev || prev.summary !== value.summary || prev.ok !== value.ok;
        // eslint-disable-next-line no-await-in-loop
        await mongoose.model('LmsAdminConfig').updateOne(
          { key: 'automation:runs' },
          {
            $set: { [`value.${key}`]: value, updatedByName: 'Automation', updated: new Date() },
            ...(changed ? { $push: { history: { $each: [{ at: new Date(), byName: 'Automation', note: `${key}: ${value.summary}`.slice(0, 500), value: { key, ...value } }], $slice: -60 } } } : {}),
          },
          { upsert: true }
        );
      }
    }
    if (!dry) await mongoose.model('LmsAdminConfig').updateOne({ key: 'automation:state' }, { $set: { value: state, updated: new Date() } }, { upsert: true });
  } catch (e) {
    console.error('[lms] automation tick failed:', e.message);
  } finally {
    running = false;
  }
  return results;
}

function start() {
  console.log(`[lms] automation tick every ${Math.round(TICK_MS / 60000)} min (11 spec §17.1 workflows)`);
  setTimeout(tick, 3 * 60 * 1000); // let the server settle first
  setInterval(tick, TICK_MS);
}

start.runOnce = tick;
module.exports = start;
