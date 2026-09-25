const mongoose = require('mongoose');
const razorpayService = require('../../../../services/payments/razorpayService');
const { markPaid } = require('../../../../services/payments/markPaid');
const { paymentsConfig } = require('../../../../config/payments');

// GET /api/payments/public/return?token=...&razorpay_payment_id=...&... —
// Razorpay's Payment Link callback_url (see razorpayService.createPaymentLink).
// This is the "status comes back to us" half of the flow: the redirect
// itself carries a signature over its own query params (HMAC'd with the key
// secret), so a verified hit here is proof the payment happened without
// needing a separately-configured Dashboard webhook. Ends with a 302 to the
// public KYC page either way — the page itself re-checks real status via
// GET /api/payments/public/:token before showing the form.
async function returnHandler(req, res) {
  const token = String(req.query.token || '');
  const kycUrl = (extra) => `${paymentsConfig.crmBaseUrl}/kyc/${encodeURIComponent(token)}${extra ? `?${extra}` : ''}`;

  if (!token) return res.status(400).send('Missing token.');

  const PaymentRequest = mongoose.model('PaymentRequest');
  const doc = await PaymentRequest.findOne({ publicToken: token, removed: false });
  if (!doc) return res.status(404).send('Payment link not found.');

  const verified = razorpayService.verifyCallback(req.query);
  if (verified && req.query.razorpay_payment_link_status === 'paid') {
    const paymentId = String(req.query.razorpay_payment_id || '');
    // The callback_url redirect only proves a payment_id exists and belongs
    // to this link (verifyCallback's HMAC) — it never carries the amount, so
    // independently fetch the payment to confirm what was actually captured
    // matches what this PaymentRequest expected to charge before trusting
    // the redirect as "paid".
    let amountPaidPaise = null;
    try {
      const payment = await razorpayService.fetchPayment(paymentId);
      amountPaidPaise = payment.status === 'captured' ? payment.amount : null;
    } catch (e) {
      // Razorpay unreachable — fall through without an amount check rather
      // than failing the redirect outright; refreshStatus/webhook still
      // re-verify amount later via the Payment Link's amount_paid.
    }
    await markPaid({ query: { _id: doc._id }, razorpayPaymentId: paymentId, amountPaidPaise });
  }

  return res.redirect(302, kycUrl());
}

module.exports = returnHandler;
