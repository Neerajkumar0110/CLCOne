const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { generate: uniqueId } = require('shortid');
const { notify } = require('../../notify');
const { lmsConfig } = require('../../config/lms');
const mailer = require('./mailer');
const { renderReceiptPdf } = require('./studentReceiptPdf');

function crmBase() {
  return lmsConfig.meeting.crmBaseUrl.replace(/\/+$/, '');
}

// A Student roster row (models/appModels/Student.js) is CRM/ops data — fees,
// progress, counselor — and on its own carries no login. This gives every
// new roster row a real CRM account too (Admin, role: 'Student'), so adding
// a student from the LMS Students tab also means they can log in.
//
// Mirrors the Admin + AdminPassword pair created by the real "Add User" path
// (controllers/middlewaresControllers/createUserController/create.js) —
// login here is OTP-only (see createAuthMiddleware/login.js), so the
// password record is just a throwaway placeholder, never used to authenticate.
async function provisionLogin(studentDoc) {
  const email = String((studentDoc && studentDoc.email) || '').trim().toLowerCase();
  if (!email) return null;

  const Admin = mongoose.model('Admin');
  const AdminPassword = mongoose.model('AdminPassword');

  // Already has a login — from User Management, or an earlier roster row
  // with the same email. Leave it alone rather than creating a duplicate.
  const existing = await Admin.findOne({ email, removed: false });
  if (existing) return existing;

  const newUser = await new Admin({
    name: studentDoc.name || email.split('@')[0],
    email,
    role: 'Student',
    enabled: true,
  }).save();

  const salt = uniqueId();
  const passwordHash = bcrypt.hashSync(salt + uniqueId());
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

  return newUser;
}

// Email the student their enrollment receipt — course, batch, fee breakdown
// (incl. the fixed 18% GST) and a link into their portal — as a PDF
// attachment. Best-effort, same as every other LMS mail in this codebase.
async function sendEnrollmentEmail(studentDoc) {
  const email = String((studentDoc && studentDoc.email) || '').trim().toLowerCase();
  if (!email || !mailer.ready()) return { sent: 0 };

  const crmLink = `${crmBase()}/#/learn`;
  let attachments;
  try {
    const buffer = await renderReceiptPdf(studentDoc, { crmLink });
    attachments = [{ filename: `enrollment-${studentDoc.enrollmentId || studentDoc._id}.pdf`, content: buffer, contentType: 'application/pdf' }];
  } catch (e) {
    console.error('[lms] enrollment receipt PDF failed:', e && e.message);
    // Still send the email without the attachment rather than not at all.
  }

  return mailer.sendMail([email], {
    subject: `Welcome to ${studentDoc.course || 'your course'} — enrollment confirmed`,
    html: `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#17202c;">
      Hi ${studentDoc.name || 'there'},<br><br>
      You're enrolled${studentDoc.course ? ` in <b>${studentDoc.course}</b>` : ''}${studentDoc.batch ? ` (batch ${studentDoc.batch})` : ''}.
      Your enrollment receipt with the full fee breakdown is attached.<br><br>
      <a href="${crmLink}">Open your portal</a> to get started.
    </p>`,
    attachments,
  });
}

// Fired once, right after a new Student roster row is saved (see
// models/appModels/Student.js's post-save hook) — provisions the login,
// then emails the enrollment receipt. Never blocks the roster row.
async function onStudentCreated(studentDoc) {
  await provisionLogin(studentDoc);
  await sendEnrollmentEmail(studentDoc);
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
