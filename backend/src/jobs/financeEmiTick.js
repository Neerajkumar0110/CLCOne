const mongoose = require('mongoose');
const { createLinkForRequest } = require('../services/payments/createLinkForRequest');
const { sendEmiReminderEmail } = require('../services/payments/mailer');
const { blockStudent, overdueQuery } = require('../services/payments/financeHold');

// Three-part automation for EMI installments (PaymentRequest.planGroupId —
// see paymentsController/create.js and the courseCatalog fee plans):
//
//   1. Auto-create the next installment's Razorpay link/QR/email 10 days
//      before it falls due (mirrors the admin's manual "Collect payment"
//      button in the KYC modal, but system-initiated).
//   2. Email reminders at 10/7/5 days before, then once a day from 4 days
//      before through the due date itself.
//   3. Auto-block a student's LMS panel access (Admin.financeHold) once an
//      installment is more than 24h past its due date. Unblocking happens
//      the instant a payment succeeds — see services/payments/financeHold.js,
//      called from paymentsController/refreshStatus.js and
//      paymentsPublicController/return.js — not from this tick.
//
// Same setInterval + try/catch shape as jobs/lmsPolicyReminderTick.js — one
// bad tick logs and moves on, never crashes the process.
const TICK_MS = Number(process.env.FINANCE_EMI_TICK_MS || 60 * 60 * 1000); // 1h
const AUTO_CREATE_WINDOW_DAYS = 10;

function calendarDaysUntil(now, target) {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b - a) / 86400000);
}

// ── 1. Auto-create the next installment's payment link ─────────────────
async function autoCreateDueInstallments() {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const windowEnd = new Date(Date.now() + AUTO_CREATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await PaymentRequest.find({
    removed: false,
    status: 'paid',
    installmentCount: { $gt: 1 },
    nextInstallmentDueAt: { $ne: null, $lte: windowEnd },
  })
    .limit(500)
    .lean();

  for (const src of candidates) {
    if (src.installmentNo >= src.installmentCount) continue;
    // eslint-disable-next-line no-await-in-loop
    const hasSuccessor = await PaymentRequest.exists({
      removed: false,
      planGroupId: src.planGroupId,
      installmentNo: src.installmentNo + 1,
    });
    if (hasSuccessor) continue;

    // eslint-disable-next-line no-await-in-loop
    const paidSiblings = await PaymentRequest.find({ removed: false, planGroupId: src.planGroupId, status: 'paid' })
      .select('amount')
      .lean();
    const paidTotal = paidSiblings.reduce((sum, s) => sum + s.amount, 0);
    const remaining = Math.max(0, (src.planTotal || 0) - paidTotal);
    const installmentsLeft = src.installmentCount - src.installmentNo;
    const amount = installmentsLeft > 0 ? Math.round(remaining / installmentsLeft) : remaining;
    if (amount <= 0) continue;

    const doc = new PaymentRequest({
      studentName: src.studentName,
      studentEmail: src.studentEmail,
      studentPhone: src.studentPhone,
      course: src.course,
      amount,
      notes: src.notes,
      createdByName: 'System (auto)',
      planGroupId: src.planGroupId,
      installmentNo: src.installmentNo + 1,
      installmentCount: src.installmentCount,
      planTotal: src.planTotal,
      dueAt: src.nextInstallmentDueAt,
    });
    try {
      // eslint-disable-next-line no-await-in-loop
      await createLinkForRequest(doc);
    } catch (e) {
      console.error('[finance] auto next-installment link failed:', e.message);
    }
  }
}

// ── 2. Reminder emails — 10/7/5 days before, then daily from day 4 ─────
async function sendEmiReminders() {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const now = new Date();
  const todayKey = now.toDateString();

  const due = await PaymentRequest.find({ removed: false, status: 'created', dueAt: { $ne: null } })
    .limit(1000)
    .lean();

  for (const doc of due) {
    const daysUntil = calendarDaysUntil(now, new Date(doc.dueAt));
    const shouldRemind = [10, 7, 5].includes(daysUntil) || (daysUntil <= 4 && daysUntil >= 0);
    if (!shouldRemind) continue;
    if (doc.lastReminderSentAt && new Date(doc.lastReminderSentAt).toDateString() === todayKey) continue;
    if (!doc.razorpayShortUrl) continue;

    try {
      // eslint-disable-next-line no-await-in-loop
      await sendEmiReminderEmail({
        email: doc.studentEmail,
        name: doc.studentName,
        course: doc.course,
        amount: doc.amount,
        dueAt: doc.dueAt,
        daysUntilDue: daysUntil,
        shortUrl: doc.razorpayShortUrl,
      });
    } catch (e) {
      console.error('[finance] EMI reminder email failed:', e.message);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await PaymentRequest.updateOne({ _id: doc._id }, { $set: { lastReminderSentAt: now } });
  }
}

// ── 3. Auto-block accounts more than 24h past due ───────────────────────
async function enforceOverdueBlocks() {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const overdue = await PaymentRequest.find(overdueQuery()).select('studentEmail').limit(1000).lean();
  const emails = [...new Set(overdue.map((d) => (d.studentEmail || '').toLowerCase()).filter(Boolean))];
  for (const email of emails) {
    // eslint-disable-next-line no-await-in-loop
    await blockStudent(email);
  }
}

async function tick() {
  require('../services/lms/health').ping('financeEmiTick');
  try {
    await autoCreateDueInstallments();
  } catch (e) {
    console.error('[finance] auto-create tick failed:', e.message);
  }
  try {
    await sendEmiReminders();
  } catch (e) {
    console.error('[finance] reminder tick failed:', e.message);
  }
  try {
    await enforceOverdueBlocks();
  } catch (e) {
    console.error('[finance] overdue-block tick failed:', e.message);
  }
}

function start() {
  console.log(`[finance] EMI tick every ${Math.round(TICK_MS / 60000)}m`);
  tick();
  setInterval(tick, TICK_MS);
}

module.exports = start;
