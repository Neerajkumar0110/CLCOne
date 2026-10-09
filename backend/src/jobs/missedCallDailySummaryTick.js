const mongoose = require('mongoose');
const mailer = require('../services/lms/mailer');

// At the end of the work day, email every agent who missed at least one
// call today (routed to them, never picked up — see CallRecord.missedByAgent
// / plivoAnswer.js's leg=agent-hangup) how many they missed. Same
// in-process-tick shape as every other job in this directory (see
// jobs/lmsDailySummaryTick.js, the template this mirrors) — checked hourly,
// sends once per calendar day, plus the /api/cron/tick safety net for the
// serverless deployment.

const TICK_MS = Number(process.env.MISSED_CALL_SUMMARY_TICK_MS || 60 * 60 * 1000); // check hourly
// 18:00 IST by default — matches CallCampaign.callingHoursEnd's own default
// (see models/appModels/operation/CallCampaign.js), i.e. "office end" for
// the calling module specifically. No separate shift-end clock exists
// elsewhere in config/shiftSchedule.js to borrow instead.
const SEND_HOUR = Number(process.env.MISSED_CALL_SUMMARY_HOUR || 18);
let _sentOnDay = null;

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function summaryHtml(count, dateStr) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto">
    <h2 style="font-size:16px;color:#b42318">You missed ${count} call${count === 1 ? '' : 's'} today</h2>
    <p style="color:#475569;font-size:13.5px">${dateStr} — these were calls routed to you that you didn't pick up in time. Check Call History in the CRM for the full list and numbers to call back.</p>
  </div>`;
}

async function sendSummary() {
  if (!mailer.ready()) return;
  const CallRecord = mongoose.model('CallRecord');
  const Admin = mongoose.model('Admin');

  const since = todayStart();
  const rows = await CallRecord.aggregate([
    { $match: { removed: false, missedByAgent: true, agent: { $ne: null }, missedByAgentAt: { $gte: since } } },
    { $group: { _id: '$agent', missed: { $sum: 1 } } },
  ]);
  if (!rows.length) return;

  const agents = await Admin.find({ _id: { $in: rows.map((r) => r._id) }, removed: false, enabled: true })
    .select('email')
    .lean();
  const emailByAgent = Object.fromEntries(agents.map((a) => [String(a._id), a.email]));
  const dateStr = since.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  for (const r of rows) {
    const email = emailByAgent[String(r._id)];
    if (!email) continue;
    // eslint-disable-next-line no-await-in-loop
    await mailer.sendMail([email], {
      subject: `You missed ${r.missed} call${r.missed === 1 ? '' : 's'} today`,
      html: summaryHtml(r.missed, dateStr),
    });
  }
}

async function runOnce() {
  try {
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    if (now.getHours() !== SEND_HOUR || _sentOnDay === dayKey) return;
    _sentOnDay = dayKey;
    await sendSummary();
  } catch (e) {
    console.error('[calling] missed-call daily summary tick failed:', e.message);
  }
}

function start() {
  setInterval(runOnce, TICK_MS);
  console.log(`[calling] missed-call daily summary tick — sends once/day around ${SEND_HOUR}:00`);
}

start.runOnce = runOnce;
module.exports = start;
