const mongoose = require('mongoose');
const razorpayService = require('../../../../services/payments/razorpayService');
const { markPaid } = require('../../../../services/payments/markPaid');

// POST /api/payments/public/webhook — the durable server-to-server
// confirmation this app was missing entirely. The Payment Link
// callback_url redirect (return.js) only fires if the student's browser
// survives back to the CRM; if the tab closes, the network drops, or the
// UPI app's redirect fails (all common), the CRM previously never learned
// the payment happened until an admin noticed and clicked "Refresh"
// (refreshStatus.js). Configure this URL once in the Razorpay Dashboard's
// Webhooks section, subscribed to `payment_link.paid`, with
// RAZORPAY_WEBHOOK_SECRET set to the secret shown there (NOT the API key
// secret).
async function webhookHandler(req, res) {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.rawBody || '';
  if (!razorpayService.verifyWebhookSignature(rawBody, signature)) {
    return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
  }

  const event = req.body || {};
  if (event.event !== 'payment_link.paid') {
    // Acknowledge (2xx) anything we don't act on so Razorpay doesn't keep
    // retrying an event we're intentionally ignoring.
    return res.status(200).json({ success: true, ignored: event.event || 'unrecognized' });
  }

  const linkEntity = event.payload && event.payload.payment_link && event.payload.payment_link.entity;
  const paymentEntity = event.payload && event.payload.payment && event.payload.payment.entity;
  if (!linkEntity || !paymentEntity) {
    return res.status(200).json({ success: true, ignored: 'missing payload entities' });
  }

  const PaymentRequest = mongoose.model('PaymentRequest');
  const doc = await PaymentRequest.findOne({ razorpayPaymentLinkId: linkEntity.id, removed: false }).select('_id');
  if (!doc) return res.status(200).json({ success: true, ignored: 'no matching PaymentRequest' });

  // paymentEntity.id (pay_xxx) is unique per payment and always present —
  // used as the idempotency key so a Razorpay retry-delivery of the same
  // event (documented behavior on a slow/non-2xx response) can't double-fire
  // notifyPaid/unblockIfClear/syncStudentFees. amountPaidPaise is verified
  // against PaymentRequest.amount inside markPaid before anything is
  // accepted as paid.
  await markPaid({
    query: { _id: doc._id },
    razorpayPaymentId: paymentEntity.id,
    amountPaidPaise: paymentEntity.amount,
    webhookEventId: paymentEntity.id,
  });

  return res.status(200).json({ success: true });
}

module.exports = webhookHandler;
