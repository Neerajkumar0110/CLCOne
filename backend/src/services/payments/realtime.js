const { notify, notifyUser } = require('../../notify');

let socket = {};
try {
  socket = require('../../socket');
} catch (e) {
  /* socket module unavailable (e.g. test harness) */
}

function fmtInr(n) {
  try {
    return Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  } catch (e) {
    return `₹${n}`;
  }
}

function broadcastUpdate(doc, extra) {
  try {
    if (socket.emitBroadcast) {
      socket.emitBroadcast('payments:updated', { id: String(doc._id), publicToken: doc.publicToken, status: doc.status, ...extra });
    }
  } catch (e) {
    /* best-effort */
  }
}

// Fired once a PaymentRequest actually transitions to 'paid' (see
// paymentsPublicController/return.js and paymentsController/refreshStatus.js
// — both call this only on the created->paid edge, never on every poll).
// Two effects: an instant bell notification for every management-tier admin
// (notify.js documents 'Payments' as one of its 'management'-audience
// modules), and a socket nudge so any open Payments tab updates its table
// live instead of needing a manual refresh. Best-effort — never throws.
async function notifyPaid(doc) {
  try {
    // the user who sent this payment link — their own notification
    if (doc.createdBy) {
      await notifyUser({
        recipient: doc.createdBy,
        module: 'Payments',
        type: 'payment.paid',
        title: `💰 Payment received — ${fmtInr(doc.amount)}`,
        body: `${doc.studentName} paid your link${doc.course ? ' · ' + doc.course : ''}${doc.installmentCount > 1 ? ` · installment ${doc.installmentNo}/${doc.installmentCount}` : ''}`,
        link: '/sales/payments',
      });
    }
    await notify({
      audience: 'management',
      actorId: doc.createdBy,
      actorName: doc.createdByName || undefined,
      module: 'Payments',
      type: 'payment.paid',
      title: `Payment received — ${fmtInr(doc.amount)}`,
      body: `${doc.studentName}${doc.course ? ' · ' + doc.course : ''}`,
      link: '/sales/payments',
    });
  } catch (e) {
    /* best-effort */
  }
  broadcastUpdate(doc);
}

// Fired once a student submits the post-payment KYC form (see
// paymentsPublicController/submitKyc.js). Same two effects as notifyPaid —
// bell notification + live table nudge — so the "KYC" column flips from
// Pending to Submitted without a manual refresh.
async function notifyKycSubmitted(doc) {
  try {
    if (doc.createdBy) {
      await notifyUser({
        recipient: doc.createdBy,
        module: 'Payments',
        type: 'payment.kyc_submitted',
        title: `KYC submitted — ${doc.studentName}`,
        body: `Your customer filled the KYC form${doc.course ? ' · ' + doc.course : ''}`,
        link: '/sales/payments',
      });
    }
    await notify({
      audience: 'management',
      actorId: doc.createdBy,
      actorName: doc.createdByName || undefined,
      module: 'Payments',
      type: 'payment.kyc_submitted',
      title: `KYC submitted — ${doc.studentName}`,
      body: doc.course || '',
      link: '/sales/payments',
    });
  } catch (e) {
    /* best-effort */
  }
  broadcastUpdate(doc, { kycSubmitted: true });
}

// Finance (EMI) KYC form submitted by the customer.
async function notifyFinanceKyc(app) {
  try {
    const amount = app.financeAmount ? ` · ${fmtInr(app.financeAmount)}` : '';
    if (app.createdBy) {
      await notifyUser({
        recipient: app.createdBy,
        module: 'Payments',
        type: 'finance.kyc_submitted',
        title: `Finance KYC submitted — ${app.studentName}`,
        body: `Your customer sent their EMI documents${amount}`,
        link: '/sales/payments',
      });
    }
    await notify({
      audience: 'management',
      actorId: app.createdBy,
      actorName: app.createdByName || undefined,
      module: 'Payments',
      type: 'finance.kyc_submitted',
      title: `Finance KYC submitted — ${app.studentName}`,
      body: `${app.course || 'EMI request'}${amount}`,
      link: '/sales/payments',
    });
  } catch (e) {
    /* best-effort */
  }
}

module.exports = { notifyPaid, notifyKycSubmitted, notifyFinanceKyc };
