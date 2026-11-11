const mongoose = require('mongoose');
const { SALES_ROLES, REVIEWER_ROLES } = require('../config/roles');
const shiftSchedule = require('../config/shiftSchedule');
const { mailReady, sendMailWithRetry } = require('../services/mail/transport');

// After the shift, once a day: each Sales user who has any gets their own
// prospects and callbacks by email, and management + Team Leaders get one
// table of every Sales user. A lead counts once per user per list.
const TICK_MS = 5 * 60 * 1000;
const fullName = (a) => `${a.name || ''} ${a.surname || ''}`.trim() || a.email;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = (d) => new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
const dayOf = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// One day's numbers per user, from Lead.stageHistory and who last moved the lead.
async function dayReport(dayKey) {
  const start = new Date(`${dayKey}T00:00:00+05:30`);
  const end = new Date(`${dayKey}T23:59:59.999+05:30`);
  const users = await mongoose.model('Admin').find({ removed: false, enabled: true, role: { $in: SALES_ROLES } }).select('name surname email role').sort({ name: 1 }).lean();
  const ids = users.map((u) => u._id);
  const Lead = mongoose.model('Lead');
  const [moved, due] = await Promise.all([
    Lead.aggregate([
      { $match: { removed: false, stageHistory: { $elemMatch: { changedBy: { $in: ids }, toStage: { $in: ['Prospects', 'Callback'] }, at: { $gte: start, $lte: end } } } } },
      { $unwind: '$stageHistory' },
      { $match: { 'stageHistory.changedBy': { $in: ids }, 'stageHistory.toStage': { $in: ['Prospects', 'Callback'] }, 'stageHistory.at': { $gte: start, $lte: end } } },
      { $sort: { 'stageHistory.at': -1 } },
      { $group: { _id: { u: '$stageHistory.changedBy', s: '$stageHistory.toStage', l: '$_id' }, name: { $first: '$name' }, phone: { $first: '$phone' }, at: { $first: '$stageHistory.at' }, remarks: { $first: '$stageHistory.remarks' }, callBackAt: { $first: '$callBackAt' } } },
    ]),
    Lead.aggregate([
      { $match: { removed: false, stage: 'Callback', callBackAt: { $gte: start, $lte: end }, 'stageHistory.changedBy': { $in: ids } } },
      { $project: { name: 1, phone: 1, callBackAt: 1, last: { $arrayElemAt: ['$stageHistory', -1] } } },
    ]),
  ]);
  return users.map((u) => {
    const uid = String(u._id);
    const mine = (s) => moved.filter((m) => String(m._id.u) === uid && m._id.s === s).sort((a, b) => new Date(b.at) - new Date(a.at));
    return { user: u, name: fullName(u), prospects: mine('Prospects'), callbacks: mine('Callback'), due: due.filter((d) => d.last && String(d.last.changedBy) === uid).sort((a, b) => new Date(a.callBackAt) - new Date(b.callBackAt)) };
  });
}

const cell = 'padding:6px 10px;border-top:1px solid #e2e8f0;text-align:left;font-size:13px';
const list = (title, rows, line) =>
  rows.length ? `<h3 style="margin:16px 0 6px;font-size:15px;color:#0f172a">${title} · ${rows.length}</h3><table style="width:100%;border-collapse:collapse">${rows.map((r) => `<tr><td style="${cell}"><b>${esc(r.name)}</b><div style="color:#64748b">${esc(r.phone)}</div></td><td style="${cell};color:#475569">${line(r)}</td></tr>`).join('')}</table>` : '';

function userHtml(r, dayLabel) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:14px">
    <h2 style="margin:0 0 4px;color:#0f172a">Your prospects and callbacks</h2>
    <p style="margin:0;color:#475569">${esc(dayLabel)}: <b>${r.prospects.length}</b> prospects · <b>${r.callbacks.length}</b> callbacks set · <b>${r.due.length}</b> callbacks due</p>
    ${list('Prospects raised', r.prospects, (x) => `${clock(x.at)}${x.remarks ? ` · ${esc(x.remarks)}` : ''}`)}
    ${list('Callbacks set', r.callbacks, (x) => `${x.callBackAt ? `Call on ${esc(new Date(x.callBackAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}` : ''}${x.remarks ? ` · ${esc(x.remarks)}` : ''}`)}
    ${list('Callbacks that were due', r.due, (x) => clock(x.callBackAt))}
  </div>`;
}

function teamHtml(report, dayLabel) {
  const sum = (k) => report.reduce((t, r) => t + r[k].length, 0);
  const th = 'padding:8px 10px;text-align:left;font-size:12px;color:#475569;background:#f1f5f9';
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:14px">
    <h2 style="margin:0 0 4px;color:#0f172a">Daily prospects and callbacks</h2>
    <p style="margin:0 0 14px;color:#475569">${esc(dayLabel)}: <b>${sum('prospects')}</b> prospects · <b>${sum('callbacks')}</b> callbacks set · <b>${sum('due')}</b> callbacks due</p>
    <table style="width:100%;border-collapse:collapse">
      <tr><th style="${th}">User</th><th style="${th}">Prospects</th><th style="${th}">Callbacks set</th><th style="${th}">Callbacks due</th></tr>
      ${[...report].sort((a, b) => b.prospects.length - a.prospects.length || b.callbacks.length - a.callbacks.length).map((r) => `<tr><td style="${cell}"><b>${esc(r.name)}</b></td><td style="${cell}">${r.prospects.length}</td><td style="${cell}">${r.callbacks.length}</td><td style="${cell}">${r.due.length}</td></tr>`).join('')}
    </table>
  </div>`;
}

const mail = (to, subject, html, templateKey, vars) => sendMailWithRetry({ from: `"CLC One" <${process.env.GMAIL_USER}>`, to, subject, html, templateKey, vars }).catch((e) => console.error('[sales-mail] email failed:', e.message));

async function sendDay(dayKey) {
  const report = await dayReport(dayKey);
  // Nothing happened at all (a Sunday, a holiday): no mail.
  if (!report.some((r) => r.prospects.length || r.callbacks.length || r.due.length)) return 0;
  const dayLabel = new Date(`${dayKey}T12:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' });
  let sent = 0;
  for (const r of report) {
    if (!r.user.email || !(r.prospects.length || r.callbacks.length || r.due.length)) continue;
    // eslint-disable-next-line no-await-in-loop
    await mail(r.user.email, `Today: ${r.prospects.length} prospects, ${r.callbacks.length} callbacks`, userHtml(r, dayLabel), 'sales-daily-user', { prospects: r.prospects.length, callbacks: r.callbacks.length, day: dayLabel });
    sent += 1;
  }
  const bosses = await mongoose.model('Admin').find({ removed: false, enabled: true, role: { $in: REVIEWER_ROLES } }).select('email').lean();
  for (const b of bosses) {
    if (!b.email) continue;
    // eslint-disable-next-line no-await-in-loop
    await mail(b.email, `Daily prospects and callbacks · ${dayLabel}`, teamHtml(report, dayLabel), 'sales-daily-team', { day: dayLabel });
    sent += 1;
  }
  return sent;
}

async function runOnce(now = new Date()) {
  if (!mailReady()) return 0;
  const dayKey = dayOf(now);
  if (now < new Date(`${dayKey}T${shiftSchedule.dailyProspectMailAt}:00+05:30`)) return 0;
  try {
    // Whoever creates this row first sends the mail; everyone else stops here.
    await mongoose.model('DailyMailRun').create({ key: `prospects:${dayKey}` });
  } catch (e) {
    if (e.code === 11000) return 0;
    throw e;
  }
  return sendDay(dayKey);
}

function start() {
  let running = false;
  setInterval(async () => {
    if (running || mongoose.connection.readyState !== 1) return;
    running = true;
    try {
      await require('../services/sales/overdueTasks').syncOverdue();
      const sent = await runOnce();
      if (sent) console.log(`[sales-mail] sent ${sent} daily prospect / callback email(s)`);
    } catch (e) {
      console.error('[sales-mail] tick failed:', e.message);
    } finally {
      running = false;
    }
  }, TICK_MS);
}

start.runOnce = runOnce;
start.dayReport = dayReport;
start.userHtml = userHtml;
start.teamHtml = teamHtml;
start.emailHtml = { userHtml, teamHtml };
module.exports = start;
