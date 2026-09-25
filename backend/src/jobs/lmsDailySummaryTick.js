const mongoose = require('mongoose');
const mailer = require('../services/lms/mailer');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES } = require('../config/roles');

// Spec §12 "Attendance/admin reporting dependent on manual sheets" — a
// real-time dashboard + CSV/XLSX export already exist (liveScope.js's
// attendanceDashboard/attendanceExport), but nothing produced a scheduled
// summary — the one piece of that requirement genuinely missing. Runs once
// per calendar day (IST, via process.env.TZ set in server.js/api/index.js),
// emails management yesterday's attendance + a few operational health
// numbers. Same in-process-tick shape as every other job in this directory —
// no cron infra in this app — plus a manual re-run via the /api/cron/tick
// safety net for the serverless deployment.

const TICK_MS = Number(process.env.LMS_DAILY_SUMMARY_TICK_MS || 60 * 60 * 1000); // check hourly
const SEND_HOUR = Number(process.env.LMS_DAILY_SUMMARY_HOUR || 8); // 8am IST
let _sentOnDay = null;

function dayBounds(daysAgo = 1) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (daysAgo - 1));
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  return { start, end };
}

async function buildSummary() {
  const { start, end } = dayBounds(1);
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const sessions = await LmsLiveSession.find({
    removed: false,
    scheduledStart: { $gte: start, $lt: end },
    status: { $in: ['ended', 'recording_processing', 'recording_available', 'cancelled'] },
  })
    .select('participants status')
    .lean();

  let present = 0;
  let late = 0;
  let partial = 0;
  let absent = 0;
  let excused = 0;
  let pctSum = 0;
  let pctCount = 0;
  const classesHeld = sessions.filter((s) => s.status !== 'cancelled').length;
  const classesCancelled = sessions.filter((s) => s.status === 'cancelled').length;

  for (const s of sessions) {
    for (const p of s.participants || []) {
      if (p.role !== 'student') continue;
      if (p.attendanceStatus === 'EXCUSED') {
        excused += 1;
        continue;
      }
      if (p.attendanceStatus === 'PRESENT') present += 1;
      else if (p.attendanceStatus === 'LATE') { present += 1; late += 1; }
      else if (p.attendanceStatus === 'PARTIAL') partial += 1;
      else absent += 1;
      pctSum += p.attendancePct || 0;
      pctCount += 1;
    }
  }

  const LmsSyncJob = mongoose.model('LmsSyncJob');
  const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
  const PaymentRequest = mongoose.model('PaymentRequest');
  const { overdueQuery } = require('../services/payments/financeHold');

  const [failedSyncJobs, pendingAcks, overdueEmis] = await Promise.all([
    LmsSyncJob.countDocuments({ status: { $in: ['failed', 'dead'] } }).catch(() => 0),
    PolicyAcknowledgement.countDocuments({ removed: { $ne: true }, status: 'pending' }).catch(() => 0),
    PaymentRequest.countDocuments(overdueQuery()).catch(() => 0),
  ]);

  return {
    date: start,
    classesHeld,
    classesCancelled,
    present,
    late,
    partial,
    absent,
    excused,
    avgAttendancePct: pctCount ? Math.round(pctSum / pctCount) : null,
    failedSyncJobs,
    pendingAcks,
    overdueEmis,
  };
}

function summaryHtml(s) {
  const dateStr = s.date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const row = (label, val) =>
    `<tr><td style="padding:4px 10px;color:#667">${label}</td><td style="padding:4px 10px;font-weight:700;text-align:right">${val}</td></tr>`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto">
    <h2 style="font-size:16px;color:#0e7490">LMS daily summary — ${dateStr}</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13.5px;border:1px solid #e3e8ef;border-radius:10px;overflow:hidden">
      ${row('Classes held', s.classesHeld)}
      ${row('Classes cancelled', s.classesCancelled)}
      ${row('Present', s.present)}
      ${row('Late', s.late)}
      ${row('Partial', s.partial)}
      ${row('Absent', s.absent)}
      ${row('Excused', s.excused)}
      ${row('Avg. attendance %', s.avgAttendancePct == null ? '—' : `${s.avgAttendancePct}%`)}
      ${row('Failed/dead Moodle sync jobs', s.failedSyncJobs)}
      ${row('Pending policy acknowledgements', s.pendingAcks)}
      ${row('EMI installments overdue', s.overdueEmis)}
    </table>
    <p style="color:#94a3b8;font-size:11.5px;margin-top:10px">Automated summary — see the LMS Attendance dashboard for live detail and CSV/Excel export.</p>
  </div>`;
}

async function sendSummary() {
  if (!mailer.ready()) return;
  const Admin = mongoose.model('Admin');
  const roles = [...new Set([...MANAGEMENT_ROLES, ...SUPER_ADMIN_ROLES])];
  const recipients = await Admin.find({ removed: false, enabled: true, role: { $in: roles } }).select('email').lean();
  const emails = recipients.map((r) => r.email).filter(Boolean);
  if (!emails.length) return;

  const summary = await buildSummary();
  await mailer.sendMail(emails, {
    subject: `LMS daily summary — ${summary.date.toLocaleDateString('en-IN')}`,
    html: summaryHtml(summary),
  });
}

async function runOnce() {
  try {
    require('../services/lms/health').ping('lmsDailySummaryTick');
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    if (now.getHours() !== SEND_HOUR || _sentOnDay === dayKey) return;
    _sentOnDay = dayKey;
    await sendSummary();
  } catch (e) {
    console.error('[lms] daily summary tick failed:', e.message);
  }
}

function start() {
  setInterval(runOnce, TICK_MS);
  console.log(`[lms] daily summary tick — sends once/day around ${SEND_HOUR}:00`);
}

start.runOnce = runOnce;
module.exports = start;
