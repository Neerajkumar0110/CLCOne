const nodemailer = require('nodemailer');
const { lmsConfig } = require('../../config/lms');

// Reuses the same Gmail transport as the OTP mailer. All LMS emails are
// best-effort — a send failure never blocks the action that triggered it.

const BRAND = process.env.GMAIL_SENDER_NAME || 'Career Lab Consulting';
let _tx = null;
function tx() {
  if (!_tx) {
    _tx = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return _tx;
}
const ready = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function fmtDate(d) {
  try {
    return new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return String(d);
  }
}

// batch: LmsBatchRoom-ish { batchName, courseTitle, teacherName }
// schedule: { days, time, durationMin, from, to }
// sessions: [{ scheduledStart }] (next few)
function batchClassEmailHtml({ batchName, courseTitle, teacherName, schedule = {}, sessions = [], joinPageUrl }) {
  const rows = sessions
    .slice(0, 8)
    .map((s) => `<li style="margin:2px 0">${esc(fmtDate(s.scheduledStart))}</li>`)
    .join('');
  return `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:560px;margin:0 auto">
  <h2 style="margin:0 0 4px">You're enrolled — ${esc(courseTitle || batchName)}</h2>
  <p style="color:#556">Batch: <b>${esc(batchName)}</b>${teacherName ? ` · Trainer: <b>${esc(teacherName)}</b>` : ''}</p>
  <div style="border:1px solid #e3e8ef;border-radius:12px;padding:16px 18px;margin:14px 0">
    <p style="margin:0 0 6px"><b>Class schedule</b></p>
    <p style="margin:0;color:#334">
      ${schedule.days ? `Days: ${esc(schedule.days)}<br>` : ''}
      ${schedule.time ? `Time: ${esc(schedule.time)}` : ''}${schedule.durationMin ? ` · ${schedule.durationMin} min` : ''}<br>
      ${schedule.from ? `From ${esc(fmtDate(schedule.from))}` : ''}${schedule.to ? ` to ${esc(fmtDate(schedule.to))}` : ''}
    </p>
    ${rows ? `<p style="margin:10px 0 4px"><b>Next classes</b></p><ul style="margin:0;padding-left:18px">${rows}</ul>` : ''}
  </div>
  <p style="margin:16px 0">
    <a href="${esc(joinPageUrl)}" style="display:inline-block;background:#2f5fd0;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Open Live Classes</a>
  </p>
  <p style="color:#889;font-size:13px">Sign in to the portal, then click <b>Join Live Class</b> when the class is live. The same link works for the whole batch — no new link each class.</p>
</div>`;
}

async function sendBatchClassEmail(recipients, payload) {
  if (!lmsConfig.meeting.emailBatchStudents || !ready()) return { sent: 0, skipped: 'email disabled / not configured' };
  const list = [...new Set((recipients || []).map((r) => String(r || '').trim().toLowerCase()).filter((e) => /.+@.+\..+/.test(e)))];
  if (!list.length) return { sent: 0 };
  const html = batchClassEmailHtml(payload);
  let sent = 0;
  for (const to of list) {
    try {
      await tx().sendMail({
        from: `"${BRAND}" <${process.env.GMAIL_USER}>`,
        to,
        subject: `Your live classes — ${payload.batchName}`,
        html,
      });
      sent += 1;
    } catch (e) {
      console.error('[lms] batch class email failed for', to, ':', e.message);
    }
  }
  return { sent };
}

// Generic best-effort fan-out — used by announcements, certificate issue, etc.
async function sendMail(recipients, { subject, html, text }) {
  if (!ready()) return { sent: 0, skipped: 'email not configured' };
  const list = [...new Set((recipients || []).map((r) => String(r || '').trim().toLowerCase()).filter((e) => /.+@.+\..+/.test(e)))];
  if (!list.length) return { sent: 0 };
  let sent = 0;
  for (const to of list) {
    try {
      await tx().sendMail({ from: `"${BRAND}" <${process.env.GMAIL_USER}>`, to, subject: subject || BRAND, html, text });
      sent += 1;
    } catch (e) {
      console.error('[lms] sendMail failed for', to, ':', e.message);
    }
  }
  return { sent };
}

module.exports = { sendBatchClassEmail, sendMail, ready };
