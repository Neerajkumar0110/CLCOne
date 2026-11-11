// Sends the custom emails admins create in Messenger › Email on their
// schedule (once / daily / weekly / after enrolment / before or after each
// class) — services/mail/emailSchedule.js. Every 5 minutes; each occurrence
// goes to each person once (EmailTemplateSend), so a restart or an
// overlapping tick never sends twice. A failing email never stops the others.
const mongoose = require('mongoose');

const TICK_MS = Number(process.env.EMAIL_SCHEDULE_TICK_MS || 5 * 60 * 1000);
let running = false;

async function tick(now = new Date()) {
  if (running) return { skipped: true };
  running = true;
  const out = {};
  try {
    const sched = require('../services/mail/emailSchedule');
    if (!sched.mailReady()) return { skipped: 'email not configured' };
    const list = await mongoose.model('EmailTemplate').find({ removed: false, kind: 'custom', enabled: true }).lean();
    for (const t of list) {
      try {
        // eslint-disable-next-line no-await-in-loop
        out[t.key] = await sched.run(t, now);
        if (out[t.key]) console.log(`[email] custom "${t.name}": ${out[t.key]} sent`);
      } catch (e) {
        console.error(`[email] custom "${t.name}" failed:`, e.message);
      }
    }
  } catch (e) {
    console.error('[email] schedule tick failed:', e.message);
  } finally {
    running = false;
  }
  return out;
}

function start() {
  console.log(`[email] custom email scheduler every ${Math.round(TICK_MS / 60000)} min`);
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, TICK_MS);
}

start.runOnce = tick;
module.exports = start;
