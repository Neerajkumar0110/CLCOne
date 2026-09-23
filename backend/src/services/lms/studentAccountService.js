const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { generate: uniqueId } = require('shortid');
const { notify } = require('../../notify');
const { lmsConfig } = require('../../config/lms');
const mailer = require('./mailer');
const { renderReceiptPdf } = require('./studentReceiptPdf');
const { planForRequest } = require('../payments/studentProvision');

function crmBase() {
  return lmsConfig.meeting.crmBaseUrl.replace(/\/+$/, '');
}

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function fmtInr(n) {
  try {
    return Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  } catch (e) {
    return `Rs. ${n}`;
  }
}

// A real, memorable-but-not-guessable-by-strangers login password — the
// student's name, lowercased with everything but letters/digits stripped,
// plus a fixed "@123" suffix (the exact scheme the admin asked for). Falls
// back to the email's local part for a blank/symbols-only name so this
// never produces an empty password.
function derivePassword(name, email) {
  const fromName = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const fromEmail = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${fromName || fromEmail || 'student'}@123`;
}

let LOGO_PATH = null;
try {
  const p = path.join(__dirname, 'assets', 'clc-logo.png');
  if (fs.existsSync(p)) LOGO_PATH = p;
} catch (e) {
  /* logo stays unavailable, email still sends without it */
}

// A Student roster row (models/appModels/Student.js) is CRM/ops data — fees,
// progress, counselor — and on its own carries no login. This gives every
// new roster row a real CRM account too (Admin, role: 'Student'), so adding
// a student from the LMS Students tab (or an auto-created one, from a paid
// candidate's KYC — see services/payments/studentProvision.js) also means
// they can log in.
//
// Mirrors the Admin + AdminPassword pair created by the real "Add User" path
// (controllers/middlewaresControllers/createUserController/create.js).
// Login supports both OTP (createAuthMiddleware/login.js — every role) and,
// for Students specifically, a direct email+password shortcut
// (createAuthMiddleware/loginWithPassword.js) — so the real password set
// here (not a throwaway hash) actually works. `rawPassword` on the return
// value is only ever populated the moment the account is first created —
// it exists in plaintext nowhere else, so this is the one place the
// enrollment email can pick it up to tell the student what it is.
async function provisionLogin(studentDoc) {
  const email = String((studentDoc && studentDoc.email) || '').trim().toLowerCase();
  if (!email) return {};

  const Admin = mongoose.model('Admin');
  const AdminPassword = mongoose.model('AdminPassword');

  // Already has a login — from User Management, or an earlier roster row
  // with the same email. Leave it alone rather than creating a duplicate
  // (and never reset an existing password on a later re-save/edit).
  const existing = await Admin.findOne({ email, removed: false });
  if (existing) return { user: existing };

  const newUser = await new Admin({
    name: studentDoc.name || email.split('@')[0],
    email,
    role: 'Student',
    enabled: true,
  }).save();

  const rawPassword = derivePassword(studentDoc.name, email);
  const salt = uniqueId();
  const passwordHash = bcrypt.hashSync(salt + rawPassword);
  await new AdminPassword({ password: passwordHash, salt, emailVerified: true, user: newUser._id }).save();

  notify({
    audience: 'management',
    module: 'User Management',
    type: 'user.created',
    title: `${newUser.name} can now log in as a Student`,
    body: `${newUser.email} — auto-provisioned from the LMS Students roster.`,
    link: '/user-management',
  });

  // Same Moodle mirroring the real "Add User" path does for every new Admin
  // (services/lms, jobs/lmsSyncTick.js) — no-op until the LMS is configured.
  try {
    const { queue } = require('./index');
    await queue.enqueue('user.provision', { crmUserId: String(newUser._id) }, { dedupeKey: `user.provision:${newUser._id}` });
  } catch (e) {
    console.error('[lms] user.provision enqueue failed:', e && e.message);
  }

  return { user: newUser, rawPassword };
}

// Full brand-styled HTML for the enrollment email — logo, greeting, the
// course + fee snapshot (paid / due, pulled live off the linked
// PaymentRequest's EMI plan when there is one — see studentProvision.js),
// login credentials, and a CTA into the portal. The full month-by-month
// installment schedule lives in the attached PDF (see studentReceiptPdf.js)
// rather than being repeated here, to keep the email itself short.
function enrollmentEmailHtml(studentDoc, { crmLink, rawPassword, plan, brand = 'Career Lab Consulting' } = {}) {
  const name = studentDoc.name || 'there';
  const feeGrandTotal = plan ? plan.planTotal : studentDoc.feeGrandTotal;
  const feePaid = plan ? plan.paidTotal : studentDoc.feePaid;
  const feeDue = plan ? plan.remaining : studentDoc.feeDue;

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;background:#fff">
  <div style="background:#0e7490;border-radius:14px 14px 0 0;padding:22px 26px;text-align:center">
    ${LOGO_PATH ? `<img src="cid:clc-enrollment-logo" alt="${esc(brand)}" height="34" style="display:block;margin:0 auto 10px" />` : ''}
    <span style="color:#dff4f8;font-size:12.5px;letter-spacing:.4px;text-transform:uppercase;font-weight:600">Enrollment confirmed</span>
  </div>
  <div style="border:1px solid #e3e8ef;border-top:none;border-radius:0 0 14px 14px;padding:26px">
    <p style="font-size:15px;color:#17202c;margin:0 0 6px">Hi ${esc(name)},</p>
    <p style="font-size:15px;color:#17202c;margin:0 0 20px;line-height:1.55">
      Welcome to <b>${esc(studentDoc.course || 'your course')}</b>${studentDoc.batch ? ` (batch ${esc(studentDoc.batch)})` : ''} —
      you're officially enrolled. Your full fee receipt${plan ? ' and EMI schedule' : ''} is attached as a PDF.
    </p>

    <div style="border:1px solid #e3e8ef;border-radius:12px;padding:16px 18px;margin:0 0 18px;background:#fafbfc">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;color:#334">
        <tr><td style="padding:3px 0;color:#889">Total payable</td><td style="padding:3px 0;text-align:right;font-weight:700">${esc(fmtInr(feeGrandTotal))}</td></tr>
        <tr><td style="padding:3px 0;color:#889">Paid so far</td><td style="padding:3px 0;text-align:right;font-weight:700;color:#0e7490">${esc(fmtInr(feePaid))}</td></tr>
        <tr><td style="padding:3px 0;color:#889">Balance due</td><td style="padding:3px 0;text-align:right;font-weight:700;color:${feeDue > 0 ? '#b45309' : '#0e7490'}">${esc(fmtInr(feeDue))}</td></tr>
      </table>
    </div>

    ${
      rawPassword
        ? `<div style="border:1px dashed #0e7490;border-radius:12px;padding:16px 18px;margin:0 0 20px">
      <p style="margin:0 0 8px;font-size:12.5px;color:#889;text-transform:uppercase;letter-spacing:.4px">Your portal login</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#17202c">
        <tr><td style="padding:2px 0;color:#889;width:80px">Email</td><td style="padding:2px 0;font-weight:600">${esc(studentDoc.email)}</td></tr>
        <tr><td style="padding:2px 0;color:#889">Password</td><td style="padding:2px 0;font-weight:600">${esc(rawPassword)}</td></tr>
      </table>
      <p style="margin:8px 0 0;font-size:12.5px;color:#889">Log in with this password, or request a one-time code instead — both work.</p>
    </div>`
        : ''
    }

    <p style="text-align:center;margin:0 0 8px">
      <a href="${esc(crmLink)}" style="display:inline-block;background:#0b5b70;color:#fff;text-decoration:none;padding:13px 28px;border-radius:9px;font-weight:700;font-size:14.5px">Open your student portal</a>
    </p>
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin:0 0 22px">${esc(crmLink)}</p>

    <p style="color:#889;font-size:12.5px;margin:0;border-top:1px solid #eef1f5;padding-top:14px">This is an automated email from ${esc(brand)}. Keep your enrollment receipt (attached) for your records.</p>
  </div>
</div>`;
}

// Email the student their enrollment receipt — course, batch, fee breakdown
// (incl. paid/due pulled live off their EMI plan) and a link into their
// portal — as a PDF attachment, plus the same summary + their login
// password inline in the email body. Best-effort, same as every other LMS
// mail in this codebase.
async function sendEnrollmentEmail(studentDoc, { rawPassword } = {}) {
  const email = String((studentDoc && studentDoc.email) || '').trim().toLowerCase();
  if (!email || !mailer.ready()) return { sent: 0 };

  const crmLink = `${crmBase()}/#/learn`;

  let plan = null;
  if (studentDoc.paymentRequest) {
    try {
      const PaymentRequest = mongoose.model('PaymentRequest');
      const doc = await PaymentRequest.findOne({ _id: studentDoc.paymentRequest, removed: false }).lean();
      if (doc) plan = await planForRequest(doc);
    } catch (e) {
      console.error('[lms] enrollment email plan lookup failed:', e && e.message);
    }
  }

  const attachments = [];
  if (LOGO_PATH) attachments.push({ filename: 'logo.png', path: LOGO_PATH, cid: 'clc-enrollment-logo' });
  try {
    const buffer = await renderReceiptPdf(studentDoc, { crmLink, rawPassword, plan });
    attachments.push({ filename: `enrollment-${studentDoc.enrollmentId || studentDoc._id}.pdf`, content: buffer, contentType: 'application/pdf' });
  } catch (e) {
    console.error('[lms] enrollment receipt PDF failed:', e && e.message);
    // Still send the email without the attachment rather than not at all.
  }

  return mailer.sendMail([email], {
    subject: `Welcome to ${studentDoc.course || 'your course'} — enrollment confirmed`,
    html: enrollmentEmailHtml(studentDoc, { crmLink, rawPassword, plan }),
    attachments,
  });
}

// Fired once, right after a new Student roster row is saved (see
// models/appModels/Student.js's post-save hook) — provisions the login,
// then emails the enrollment receipt. Never blocks the roster row.
async function onStudentCreated(studentDoc) {
  const { rawPassword } = await provisionLogin(studentDoc);
  await sendEnrollmentEmail(studentDoc, { rawPassword });
}

// Recomputes Batch.enrolled as an actual COUNT of non-removed Student rows
// pointing at that batch (rather than an incrementing counter, which drifts
// under concurrent create/edit/delete) — called from every place a
// student's `batch` (or `removed`) can change: Student.js's save + the
// findOneAndUpdate hooks for the generic CRUD Edit/Delete paths, and
// liveClassService's addStudentToBatch/removeStudentFromBatch.
async function syncBatchEnrolledCounts(batchNames) {
  const Batch = mongoose.model('Batch');
  const Student = mongoose.model('Student');
  const names = Array.from(new Set((batchNames || []).filter(Boolean)));
  for (const name of names) {
    const count = await Student.countDocuments({ batch: name, removed: false });
    await Batch.updateOne({ name }, { $set: { enrolled: count } });
  }
}

module.exports = { provisionLogin, sendEnrollmentEmail, onStudentCreated, syncBatchEnrolledCounts };
