const mongoose = require('mongoose');
const razorpayService = require('../../../../services/payments/razorpayService');
const { notifyPaid } = require('../../../../services/payments/realtime');
const { stampNextInstallmentDue } = require('../../../../services/payments/plan');
const { unblockIfClear } = require('../../../../services/payments/financeHold');

// POST /api/payments/:id/refresh — admin safety net: re-asks Razorpay
// directly for this Payment Link's status, in case the student paid but
// closed the tab before the callback_url redirect fired (see
// paymentsPublicController/return.js, the normal/instant path).
async function refreshStatus(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const doc = await PaymentRequest.findOne({ _id: req.params.id, removed: false });
  if (!doc) return res.status(404).json({ success: false, message: 'Payment request not found.' });
  if (!doc.razorpayPaymentLinkId) return res.status(200).json({ success: true, result: { status: doc.status } });

  let link;
  try {
    link = await razorpayService.fetchPaymentLink(doc.razorpayPaymentLinkId);
  } catch (e) {
    return res.status(502).json({ success: false, message: `Could not reach Razorpay: ${e.message}` });
  }

  const wasUnpaid = doc.status !== 'paid';
  if (link.status === 'paid' && wasUnpaid) {
    doc.status = 'paid';
    doc.paidAt = new Date();
    const payment = (link.payments || []).find((p) => p.status === 'captured') || (link.payments || [])[0];
    if (payment) doc.razorpayPaymentId = payment.payment_id;
    stampNextInstallmentDue(doc);
  } else if (['expired', 'cancelled'].includes(link.status) && doc.status === 'created') {
    doc.status = link.status;
  }
  await doc.save();
  if (wasUnpaid && doc.status === 'paid') {
    notifyPaid(doc);
    unblockIfClear(doc.studentEmail);
  }

  return res.status(200).json({ success: true, result: { status: doc.status } });
}

module.exports = refreshStatus;
