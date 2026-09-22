const { notify } = require('../../notify');

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

// Fired once a PaymentRequest actually transitions to 'paid' (see
// paymentsPublicController/return.js and paymentsController/refreshStatus.js
// — both call this only on the created->paid edge, never on every poll).
// Two effects: an instant bell notification for every management-tier admin
// (notify.js documents 'Payments' as one of its 'management'-audience
// modules), and a socket nudge so any open Payments tab updates its table
// live instead of needing a manual refresh. Best-effort — never throws.
async function notifyPaid(doc) {
  try {
    await notify({
      audience: 'management',
      module: 'Payments',
      type: 'payment.paid',
      title: `Payment received — ${fmtInr(doc.amount)}`,
      body: `${doc.studentName}${doc.course ? ' · ' + doc.course : ''}`,
      link: '/sales/payments',
    });
  } catch (e) {
    /* best-effort */
  }
  try {
    if (socket.emitBroadcast) {
      socket.emitBroadcast('payments:updated', { id: String(doc._id), publicToken: doc.publicToken, status: doc.status });
    }
  } catch (e) {
    /* best-effort */
  }
}

module.exports = { notifyPaid };
