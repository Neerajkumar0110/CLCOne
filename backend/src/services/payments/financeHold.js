const mongoose = require('mongoose');
const { notifyUser } = require('../../notify');

// "Overdue" = a still-unpaid installment whose dueAt is at least 24h in the
// past (see PaymentRequest.dueAt — only auto/collected EMI installments
// carry one). Shared by jobs/financeEmiTick.js (no email — find everyone
// overdue) and unblockIfClear below (one specific student).
function overdueQuery(studentEmail) {
  const q = {
    removed: false,
    status: 'created',
    dueAt: { $ne: null, $lte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  };
  if (studentEmail) q.studentEmail = String(studentEmail).toLowerCase();
  return q;
}

// Puts a student's LMS panel access on hold — flips Admin.financeHold, never
// `enabled` (see the model comment). No-op if there's no matching login or
// it's already on hold. Best-effort notification, never throws.
async function blockStudent(studentEmail) {
  const Admin = mongoose.model('Admin');
  const email = String(studentEmail || '').toLowerCase();
  if (!email) return;
  const admin = await Admin.findOne({ email, removed: false, role: 'Student', financeHold: { $ne: true } });
  if (!admin) return;
  admin.financeHold = true;
  admin.financeHoldAt = new Date();
  await admin.save();
  try {
    await notifyUser({
      recipient: admin._id,
      module: 'LMS',
      type: 'finance.blocked',
      title: 'Access on hold — payment overdue',
      body: 'An EMI installment is more than a day overdue. Pay now from your dashboard to restore access.',
      link: '/learn',
    });
  } catch (e) {
    /* best-effort */
  }
}

// Called after ANY PaymentRequest turns 'paid' — clears the hold the moment
// this student has no other overdue installment left, whether the account
// was blocked by the cron or the student paid before the next tick even ran.
async function unblockIfClear(studentEmail) {
  const Admin = mongoose.model('Admin');
  const PaymentRequest = mongoose.model('PaymentRequest');
  const email = String(studentEmail || '').toLowerCase();
  if (!email) return;
  const admin = await Admin.findOne({ email, removed: false, role: 'Student', financeHold: true });
  if (!admin) return;

  const stillOverdue = await PaymentRequest.exists(overdueQuery(email));
  if (stillOverdue) return;

  admin.financeHold = false;
  admin.financeHoldAt = undefined;
  await admin.save();
  try {
    await notifyUser({
      recipient: admin._id,
      module: 'LMS',
      type: 'finance.unblocked',
      title: 'Access restored',
      body: 'Your payment was received — course access is active again.',
      link: '/learn',
    });
  } catch (e) {
    /* best-effort */
  }
}

module.exports = { overdueQuery, blockStudent, unblockIfClear };
