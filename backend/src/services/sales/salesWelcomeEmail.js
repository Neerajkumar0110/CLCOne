const { escHtml: esc } = require('../../utils/emailFormat');
const { lmsConfig } = require('../../config/lms');
const mailer = require('../lms/mailer');

// Sent once, right after a Sales-pipeline Admin account is created (see
// createUserController/create.js) and also used by the one-off backfill
// (scripts/sendSalesWelcomeEmails.cjs) for accounts that already existed
// before this email existed. Login here is passwordless/OTP-only (see
// createAuthMiddleware/login.js + issueOtp.js) — there is no password to
// send, so the email only ever tells the user their login email + the login
// URL, and that an OTP will be emailed to them once they enter that email.
function loginUrl() {
  return `${lmsConfig.meeting.crmBaseUrl}/login`;
}

function salesWelcomeEmailHtml({ name, email }) {
  const url = loginUrl();
  return `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:520px;margin:0 auto">
  <h2 style="margin:0 0 4px">Welcome${name ? `, ${esc(name)}` : ''}!</h2>
  <p style="color:#556">Your CRM account is ready.</p>
  <div style="border:1px solid #e3e8ef;border-radius:12px;padding:16px 18px;margin:14px 0">
    <p style="margin:0 0 6px"><b>Login email</b></p>
    <p style="margin:0 0 14px;color:#334">${esc(email)}</p>
    <p style="margin:0;color:#334">There's no password — open the login page, enter this email, and we'll send you a one-time code (OTP) to sign in.</p>
  </div>
  <p style="margin:16px 0">
    <a href="${esc(url)}" style="display:inline-block;background:#2f5fd0;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Open CRM Login</a>
  </p>
  <p style="color:#889;font-size:13px">${esc(url)}</p>
</div>`;
}

async function sendSalesWelcomeEmail(user) {
  const subject = 'Your CRM account is ready — login details inside';
  return mailer.sendMail([user.email], {
    subject,
    html: salesWelcomeEmailHtml({ name: user.name, email: user.email }),
  });
}

module.exports = { sendSalesWelcomeEmail, salesWelcomeEmailHtml, loginUrl };
