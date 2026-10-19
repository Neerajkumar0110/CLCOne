// Finance (EMI via a finance partner) applications — the "Request type:
// Finance" path of the Sales Payments page. No payment link: the candidate
// gets an email with a link to the finance KYC form (frontend route
// /finance-kyc/:token → pages/Payments/FinanceKycForm.jsx).
const mailer = require('../lms/mailer');
const { escHtml: esc, fmtInr } = require('../../utils/emailFormat');
const { paymentsConfig } = require('../../config/payments');

const kycLink = (token) => `${String(paymentsConfig.crmBaseUrl || '').replace(/\/+$/, '')}/finance-kyc/${token}`;

function financeKycEmailHtml(app) {
  const url = kycLink(app.publicToken);
  return `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:540px;margin:0 auto">
  <h2 style="margin:0 0 4px">Complete your finance (EMI) application</h2>
  <p style="color:#556;margin:0 0 16px">Hi ${esc(app.studentName)}, to arrange EMI finance for your internship fee, please fill the short KYC form below.</p>
  <div style="border:1px solid #e3e8ef;border-radius:12px;padding:16px 18px;margin:0 0 16px">
    ${app.course ? `<p style="margin:0 0 4px"><b>Internship</b>: ${esc(app.course)}</p>` : ''}
    ${app.courseFee ? `<p style="margin:0 0 4px"><b>Course fee</b>: ${esc(fmtInr(app.courseFee))}</p>` : ''}
    ${app.financeAmount ? `<p style="margin:0 0 4px"><b>Amount to finance</b>: ${esc(fmtInr(app.financeAmount))}</p>` : ''}
    ${app.tenureMonths ? `<p style="margin:0"><b>Tenure</b>: ${esc(String(app.tenureMonths))} months</p>` : ''}
  </div>
  <p style="margin:0 0 6px;color:#334">Keep these ready (clear photos from your phone are fine):</p>
  <ul style="margin:0 0 16px;padding-left:20px;color:#334">
    <li>Aadhaar card — front and back</li>
    <li>PAN card — front</li>
    <li>Bank details — account number, IFSC, branch and the mobile number registered with the bank</li>
    <li>Your WhatsApp number</li>
  </ul>
  <p style="margin:0 0 18px">
    <a href="${esc(url)}" style="display:inline-block;background:#2f5fd0;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Fill Finance KYC Form</a>
  </p>
  <p style="color:#889;font-size:12.5px;word-break:break-all;margin:0">${esc(url)}</p>
</div>`;
}

async function sendFinanceKycEmail(app) {
  return mailer.sendMail([app.studentEmail], {
    subject: `Finance (EMI) application — complete your KYC${app.course ? ` (${app.course})` : ''}`,
    html: financeKycEmailHtml(app),
  });
}

// Mail + record the outcome on the doc (never throws).
async function emailAndRecord(app) {
  try {
    const r = await sendFinanceKycEmail(app);
    app.emailSent = !!(r && r.sent);
    app.emailError = app.emailSent ? '' : (r && r.skipped) || 'Email not sent';
  } catch (e) {
    app.emailSent = false;
    app.emailError = e.message || 'Email failed';
  }
  if (app.emailSent) app.emailSentAt = new Date();
  await app.save();
  return app;
}

const mask = (v, keep = 4) => {
  const s = String(v || '');
  return s.length > keep ? `${'•'.repeat(Math.min(8, s.length - keep))}${s.slice(-keep)}` : s;
};

// Row shape for the Payments page list.
function toRow(a) {
  return {
    id: String(a._id),
    kind: 'finance',
    studentName: a.studentName,
    studentEmail: a.studentEmail,
    studentPhone: a.studentPhone,
    course: a.course,
    courseFee: a.courseFee,
    financeAmount: a.financeAmount,
    tenureMonths: a.tenureMonths,
    status: a.status,
    kycSubmittedAt: a.kycSubmittedAt,
    emailSent: a.emailSent,
    emailError: a.emailError || undefined,
    createdByName: a.createdByName,
    created: a.created,
    kycLink: kycLink(a.publicToken),
  };
}

module.exports = { kycLink, sendFinanceKycEmail, emailAndRecord, toRow, mask };
