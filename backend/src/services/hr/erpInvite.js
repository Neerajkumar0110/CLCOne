const { escHtml: esc } = require('../../utils/emailFormat');
const { lmsConfig } = require('../../config/lms');

// "Attendance ERP — your login" email (user ask 2026-11-28): sent from
// User Management › All Users (envelope button on a Sales user) and on its
// own when a Sales account is created. Login is by OTP to this same email —
// there is no password to send.
//
// Messenger › Email template: hr-erp-invite.

function erpLoginUrl(email) {
  const base = `${lmsConfig.meeting.crmBaseUrl}/employee/login`;
  return email ? `${base}?email=${encodeURIComponent(email)}` : base;
}

async function settingsLine() {
  try {
    const S = await require('./erpAttendance').getSettings();
    const h = Math.floor(S.requiredMin / 60);
    const m = S.requiredMin % 60;
    return { shift: `${S.workStart} – ${S.workEnd}`, target: `${h}h${m ? ` ${m}m` : ''}`, idle: Math.round(S.inactivitySec / 60) };
  } catch (e) {
    return { shift: '10:00 – 20:30', target: '8h', idle: 5 };
  }
}

function erpInviteHtml({ name, email, url, shift, target, idle }) {
  const step = (n, t) =>
    `<tr><td style="width:30px;vertical-align:top;padding:6px 0"><span style="display:inline-block;width:22px;height:22px;border-radius:7px;background:#eef2ff;color:#4f46e5;font-weight:700;font-size:12px;text-align:center;line-height:22px">${n}</span></td><td style="padding:6px 0;color:#334155;font-size:14px;line-height:21px">${t}</td></tr>`;
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:20px 24px">
    <div style="font-size:12px;opacity:.85">CLC One · Employee Portal</div>
    <div style="font-size:19px;font-weight:700;margin-top:4px">Your Attendance ERP login${name ? `, ${esc(name)}` : ''}</div>
  </div>
  <div style="padding:22px 24px;color:#334155;font-size:14px;line-height:22px">
    <p style="margin:0 0 14px">Your attendance, working hours and leaves are now in the Employee Portal.</p>
    <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin:0 0 16px;background:#f8fafc">
      <div style="font-size:12px;color:#64748b">Login email</div>
      <div style="font-weight:700;color:#0f172a;margin-top:2px">${esc(email)}</div>
      <div style="font-size:12px;color:#64748b;margin-top:10px">No password — sign in with a one-time code (OTP) sent to this email.</div>
    </div>
    <p style="margin:0 0 18px"><a href="${esc(url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">Open Employee Portal</a></p>
    <div style="font-weight:700;color:#0f172a;margin:0 0 4px">How to sign in</div>
    <table style="border-collapse:collapse;width:100%">
      ${step(1, 'Open the link above (or go to <b>/employee/login</b>).')}
      ${step(2, `Enter <b>${esc(email)}</b> and press <b>Send login code</b>.`)}
      ${step(3, 'Open the code we email you (valid 10 minutes) and type it in. Only this email can sign in to your account.')}
    </table>
    <div style="font-weight:700;color:#0f172a;margin:16px 0 4px">How your day is counted</div>
    <ul style="margin:0;padding-left:18px;color:#334155">
      <li>Shift <b>${esc(shift)}</b>. Your day starts when you sign in — login time comes from the server clock.</li>
      <li>Target <b>${esc(target)} of actual work</b>. Lunch and breaks are not counted.</li>
      <li>No mouse or keyboard for <b>${esc(String(idle))} minutes</b> counts as inactive. A dialer call always counts as active.</li>
      <li>Keep one CRM tab open while you work, and press <b>Logout</b> at the end of the day.</li>
      <li>Apply for leave and follow its approval in <b>Apply Leave</b> / <b>My Leaves</b>.</li>
      <li>Privacy: only whether the mouse or keyboard was used is noticed — never what you type, your screen or messages.</li>
    </ul>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Signing in on another device signs the old one out. Link: ${esc(url)}</p>
  </div>
  <div style="padding:14px 24px;background:#f8fafc;font-size:11px;color:#64748b">Career Lab Consulting · CLC One · template hr-erp-invite</div>
</div>`;
}

async function buildErpInvite(user) {
  const url = erpLoginUrl(user.email);
  const s = await settingsLine();
  const name = user.name || '';
  return {
    subject: 'Your Attendance ERP login — Employee Portal',
    html: erpInviteHtml({ name, email: user.email, url, ...s }),
    vars: { name, loginEmail: user.email, loginLink: url, shift: s.shift, target: s.target },
  };
}

async function sendErpInvite(user) {
  const m = await buildErpInvite(user);
  return require('../lms/mailer').sendMail([user.email], { subject: m.subject, html: m.html, templateKey: 'hr-erp-invite', vars: m.vars });
}

module.exports = { sendErpInvite, buildErpInvite, erpInviteHtml, erpLoginUrl };
