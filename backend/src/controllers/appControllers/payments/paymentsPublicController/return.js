const mongoose = require('mongoose');
const razorpayService = require('../../../../services/payments/razorpayService');
const { notifyPaid } = require('../../../../services/payments/realtime');
const { stampNextInstallmentDue } = require('../../../../services/payments/plan');
const { unblockIfClear } = require('../../../../services/payments/financeHold');
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
  if (verified && req.query.razorpay_payment_link_status === 'paid' && doc.status !== 'paid') {
    doc.status = 'paid';
    doc.paidAt = new Date();
    doc.razorpayPaymentId = String(req.query.razorpay_payment_id || '');
    stampNextInstallmentDue(doc);
    await doc.save();
    notifyPaid(doc);
    unblockIfClear(doc.studentEmail);
  }

  return res.redirect(302, kycUrl());
}

module.exports = returnHandler;
