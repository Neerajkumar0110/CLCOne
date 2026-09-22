const mongoose = require('mongoose');
const { qrDataUrl } = require('../../../../services/payments/qr');
const { sendPaymentLinkEmail } = require('../../../../services/payments/mailer');

// POST /api/payments/:id/resend — re-sends the payment link + QR email.
async function resend(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const doc = await PaymentRequest.findOne({ _id: req.params.id, removed: false });
  if (!doc) return res.status(404).json({ success: false, message: 'Payment request not found.' });
  if (!doc.razorpayShortUrl) return res.status(400).json({ success: false, message: 'No payment link on this request yet.' });

  const qr = await qrDataUrl(doc.razorpayShortUrl);
  try {
    const sent = await sendPaymentLinkEmail({
      email: doc.studentEmail,
      name: doc.studentName,
      course: doc.course,
      amount: doc.amount,
      shortUrl: doc.razorpayShortUrl,
      qrDataUrl: qr,
    });
    doc.emailSent = (sent.sent || 0) > 0;
    doc.emailSentAt = doc.emailSent ? new Date() : doc.emailSentAt;
    doc.emailError = doc.emailSent ? '' : sent.skipped || 'Send failed';
    await doc.save();
  } catch (e) {
    doc.emailError = e.message;
    await doc.save();
    return res.status(502).json({ success: false, message: `Email failed: ${e.message}` });
  }

  return res.status(200).json({ success: true, result: { emailSent: doc.emailSent, qrDataUrl: qr } });
}

module.exports = resend;
