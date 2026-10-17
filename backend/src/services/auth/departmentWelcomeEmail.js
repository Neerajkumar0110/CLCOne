const { escHtml: esc } = require('../../utils/emailFormat');
const mailer = require('../lms/mailer');
const { loginUrl } = require('../sales/salesWelcomeEmail');
const { departmentOfRole } = require('../../config/roles');

// Sent once when a DEPARTMENT account (Sales, Support, Finance, Admin…) is
// created in User Management (createUserController/create.js). Department
// login is OTP-only — no password to send. When the same email also has an
// LMS account (one email = one LMS + one department account, see
// services/auth/accounts.js), it spells out which login opens which.
function html({ name, email, role, department, hasLms }) {
  const url = loginUrl();
  return `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:540px;margin:0 auto">
  <h2 style="margin:0 0 4px">Welcome${name ? `, ${esc(name)}` : ''}!</h2>
  <p style="color:#556">Your <b>${esc(department)}</b> account at Career Lab Consulting is ready.</p>
  <div style="border:1px solid #e3e8ef;border-radius:12px;padding:16px 18px;margin:14px 0">
    <p style="margin:0 0 4px"><b>Department</b>: ${esc(department)}</p>
    <p style="margin:0 0 4px"><b>Role</b>: ${esc(role)}</p>
    <p style="margin:0 0 12px"><b>Login email</b>: ${esc(email)}</p>
    <p style="margin:0;color:#334">There's no password for this account — open the login page, enter this email and tap <b>Send code</b>. We'll email you a one-time code (OTP) to sign in to your ${esc(department)} panel.</p>
  </div>
  ${
    hasLms
      ? `<div style="border:1px solid #fde68a;background:#fffbeb;border-radius:12px;padding:12px 16px;margin:14px 0;color:#92400e;font-size:14px">
    This email also has an <b>LMS (learning) account</b>. They stay separate:<br>
    • <b>Login with code (OTP)</b> → your ${esc(department)} account<br>
    • <b>Login with a password</b> → your LMS account (your existing LMS password)
  </div>`
      : ''
  }
  <p style="margin:16px 0">
    <a href="${esc(url)}" style="display:inline-block;background:#2f5fd0;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Open Login</a>
  </p>
  <p style="color:#889;font-size:13px">${esc(url)}</p>
</div>`;
}

async function sendDepartmentWelcomeEmail(user, { hasLms = false } = {}) {
  const department = departmentOfRole(user.role);
  return mailer.sendMail([user.email], {
    subject: `Your ${department} account is ready — login details inside`,
    html: html({ name: user.name, email: user.email, role: user.role, department, hasLms }),
  });
}

module.exports = { sendDepartmentWelcomeEmail, departmentWelcomeHtml: html };
