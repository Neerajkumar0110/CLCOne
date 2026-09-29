const mongoose = require('mongoose');
const mailer = require('../services/lms/mailer');
const { unassignedBatchAlert } = require('../services/lms');
const { escHtml: esc } = require('../utils/emailFormat');

// Daily reminder to every Support-role account: how many students have no
// batch assigned yet. Same once-a-day-around-SEND_HOUR shape as
// jobs/lmsDailySummaryTick.js. Sends nothing on a day with zero unassigned
// students — the reminder is meant to stop the moment the backlog clears,
// not to keep landing as a "0 students" no-op every morning.

const TICK_MS = Number(process.env.LMS_UNASSIGNED_BATCH_TICK_MS || 60 * 60 * 1000); // check hourly
const SEND_HOUR = Number(process.env.LMS_UNASSIGNED_BATCH_HOUR || 9); // 9am IST
let _sentOnDay = null;

function summaryHtml(count, rows) {
  const shown = rows.slice(0, 50);
  const row = (s) =>
    `<tr>
      <td style="padding:5px 10px;border-bottom:1px solid #eef1f5">${esc(s.name || '—')}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #eef1f5">${esc(s.email || '—')}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #eef1f5">${esc(s.course || '—')}</td>
    </tr>`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto">
    <h2 style="font-size:16px;color:#b45309">⚠️ ${count} candidate${count === 1 ? '' : 's'} with no batch assigned</h2>
    <p style="color:#667;font-size:13px">These candidates can't attend live classes, see curriculum, or unlock assessments until a batch is set on their roster row.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e3e8ef;border-radius:8px;overflow:hidden">
      <thead><tr style="background:#f8fafc;text-align:left">
        <th style="padding:6px 10px">Name</th><th style="padding:6px 10px">Email</th><th style="padding:6px 10px">Course</th>
      </tr></thead>
      <tbody>${shown.map(row).join('')}</tbody>
    </table>
    ${rows.length > shown.length ? `<p style="color:#94a3b8;font-size:11.5px;margin-top:8px">+ ${rows.length - shown.length} more — open Candidates in the CRM and filter for an empty Batch.</p>` : ''}
    <p style="color:#94a3b8;font-size:11.5px;margin-top:10px">Automated daily reminder — sent every morning until every candidate above has a batch.</p>
  </div>`;
}

async function sendReminder() {
  if (!mailer.ready()) return;
  const count = await unassignedBatchAlert.countUnassigned();
  if (!count) return;

  const Admin = mongoose.model('Admin');
  const recipients = await Admin.find({ removed: false, enabled: true, role: 'Support' }).select('email').lean();
  const emails = recipients.map((r) => r.email).filter(Boolean);
  if (!emails.length) return;

  const rows = await unassignedBatchAlert.listUnassigned(200);
  await mailer.sendMail(emails, {
    subject: `${count} candidate${count === 1 ? '' : 's'} need a batch assigned`,
    html: summaryHtml(count, rows),
  });
}

async function runOnce() {
  try {
    require('../services/lms/health').ping('lmsUnassignedBatchTick');
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    if (now.getHours() !== SEND_HOUR || _sentOnDay === dayKey) return;
    _sentOnDay = dayKey;
    await sendReminder();
  } catch (e) {
    console.error('[lms] unassigned-batch tick failed:', e.message);
  }
}

function start() {
  setInterval(runOnce, TICK_MS);
  console.log(`[lms] unassigned-batch reminder tick — sends once/day around ${SEND_HOUR}:00 if any students are unassigned`);
}

start.runOnce = runOnce;
module.exports = start;
