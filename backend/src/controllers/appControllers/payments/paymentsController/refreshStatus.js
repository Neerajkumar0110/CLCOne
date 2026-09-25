const mongoose = require('mongoose');
const razorpayService = require('../../../../services/payments/razorpayService');
const { markPaid } = require('../../../../services/payments/markPaid');

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

  if (link.status === 'paid') {
    const payment = (link.payments || []).find((p) => p.status === 'captured') || (link.payments || [])[0];
    // amount_paid is in paise, straight off the Payment Link object — no
    // extra API call needed (unlike return.js, which only has a payment_id).
    const result = await markPaid({
      query: { _id: doc._id },
      razorpayPaymentId: payment ? payment.payment_id : undefined,
      amountPaidPaise: typeof link.amount_paid === 'number' ? link.amount_paid : null,
      admin: req.admin,
      source: 'admin-refresh',
    });
    if (!result.ok && result.mismatch) {
      return res.status(409).json({
        success: false,
        message: `Razorpay shows ₹${(result.doc.razorpayAmountPaid || 0).toLocaleString('en-IN')} paid, but this request expects ₹${doc.amount.toLocaleString('en-IN')}. Flagged for manual review — not marked paid.`,
      });
    }
    const finalDoc = result.doc || doc;
    return res.status(200).json({ success: true, result: { status: finalDoc.status } });
  }

  if (['expired', 'cancelled'].includes(link.status) && doc.status === 'created') {
    doc.status = link.status;
    await doc.save();
  }

  return res.status(200).json({ success: true, result: { status: doc.status } });
}

module.exports = refreshStatus;
