const mongoose = require('mongoose');
const { notifyPaid } = require('./realtime');
const { stampNextInstallmentDue } = require('./plan');
const { unblockIfClear } = require('./financeHold');
const { syncStudentFees } = require('./studentProvision');

// Single choke point for "mark this PaymentRequest paid" — shared by the
// browser callback (paymentsPublicController/return.js), the admin manual
// refresh (paymentsController/refreshStatus.js), and the real Razorpay
// webhook (paymentsPublicApi.js). Previously each of those three read
// `doc.status !== 'paid'` and then `.save()`'d independently, so two of them
// firing close together (e.g. the student's redirect landing the same
// instant an admin clicks "Refresh") could both pass the check before either
// write landed, double-firing notifyPaid/unblockIfClear/syncStudentFees.
//
// Returns:
//   { ok: true,  alreadyPaid: false, doc } — this call won the transition
//   { ok: true,  alreadyPaid: true,  doc } — already paid / lost the race /
//                                            a replayed webhook event
//   { ok: false, mismatch: true,     doc } — amount didn't match; flagged,
//                                            never marked paid
//   { ok: false, notFound: true }
async function markPaid({ query, razorpayPaymentId, amountPaidPaise, webhookEventId, admin, source }) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const doc = await PaymentRequest.findOne(query);
  if (!doc) return { ok: false, notFound: true };

  if (webhookEventId && doc.handledWebhookEventIds.includes(webhookEventId)) {
    return { ok: true, alreadyPaid: true, doc };
  }
  if (doc.status === 'paid') {
    if (webhookEventId) await PaymentRequest.updateOne({ _id: doc._id }, { $addToSet: { handledWebhookEventIds: webhookEventId } });
    return { ok: true, alreadyPaid: true, doc };
  }

  // The amount actually captured must match what the CRM expected to
  // charge — nothing previously checked this at all; every caller trusted
  // Razorpay's `status`/`link_status` field alone.
  if (amountPaidPaise != null) {
    const expectedPaise = Math.round(Number(doc.amount) * 100);
    if (amountPaidPaise !== expectedPaise) {
      await PaymentRequest.updateOne(
        { _id: doc._id },
        { $set: { amountMismatch: true, razorpayAmountPaid: amountPaidPaise / 100 } }
      );
      return { ok: false, mismatch: true, doc };
    }
  }

  const update = {
    $set: { status: 'paid', paidAt: new Date(), razorpayPaymentId: razorpayPaymentId || doc.razorpayPaymentId },
  };
  if (webhookEventId) update.$addToSet = { handledWebhookEventIds: webhookEventId };
  // KYC is only ever collected once per enrollment, against the first
  // installment — a later one turning 'paid' here must not leave
  // kycSubmitted=false, or the student's payment page shows the KYC form
  // again (see the original comment this replaced in return.js/refreshStatus.js).
  if (doc.installmentNo > 1) {
    update.$set.kycSubmitted = true;
    update.$set.kycSubmittedAt = new Date();
  }

  // Atomic transition — status:'paid' guard is IN the filter, so of the
  // (browser callback / admin refresh / webhook) racing to confirm the same
  // payment, only one can actually flip it.
  const claimed = await PaymentRequest.findOneAndUpdate({ _id: doc._id, status: { $ne: 'paid' } }, update, { new: true });
  if (!claimed) {
    if (webhookEventId) await PaymentRequest.updateOne({ _id: doc._id }, { $addToSet: { handledWebhookEventIds: webhookEventId } });
    return { ok: true, alreadyPaid: true, doc };
  }

  stampNextInstallmentDue(claimed);
  await claimed.save();

  notifyPaid(claimed);
  unblockIfClear(claimed.studentEmail);
  syncStudentFees(claimed.studentEmail);

  // Spec §17 "every sensitive change records who/what/when" — an admin
  // manually confirming a payment (as opposed to the automatic webhook/
  // browser-callback paths, which are routine and already covered by
  // EmailDeliveryLog/handledWebhookEventIds) previously left no audit trail.
  if (admin) {
    require('../lms/auditLog')
      .record({
        module: 'payments',
        action: 'mark-paid',
        entityType: 'PaymentRequest',
        entityId: claimed._id,
        admin,
        meta: { source: source || 'admin', amount: claimed.amount, razorpayPaymentId: claimed.razorpayPaymentId },
      })
      .catch(() => {});
  }

  return { ok: true, alreadyPaid: false, doc: claimed };
}

module.exports = { markPaid };
