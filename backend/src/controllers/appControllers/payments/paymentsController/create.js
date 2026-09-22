const mongoose = require('mongoose');
const razorpayService = require('../../../../services/payments/razorpayService');
const { qrDataUrl } = require('../../../../services/payments/qr');
const { sendPaymentLinkEmail } = require('../../../../services/payments/mailer');
const { paymentsConfig } = require('../../../../config/payments');

// POST /api/payments — admin creates a fee-collection request: a Razorpay
// Payment Link, a QR encoding it (returned inline for the admin tab), and a
// best-effort email to the student with both.
async function create(req, res) {
  if (!paymentsConfig.isConfigured) {
    return res.status(503).json({ success: false, message: 'Razorpay is not configured on the server.' });
  }
  const b = req.body || {};
  const studentName = String(b.studentName || '').trim();
  const studentEmail = String(b.studentEmail || '').trim().toLowerCase();
  const amount = Number(b.amount);
  const course = String(b.course || '').trim();
  const notes = String(b.notes || '').trim();

  if (!studentName) return res.status(400).json({ success: false, message: 'Student name is required.' });
  if (!/.+@.+\..+/.test(studentEmail)) return res.status(400).json({ success: false, message: 'A valid student email is required.' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Enter a valid amount.' });

  const PaymentRequest = mongoose.model('PaymentRequest');
  const doc = new PaymentRequest({
    studentName,
    studentEmail,
    course,
    amount,
    notes,
    createdBy: req.admin._id,
    createdByName: req.admin.name,
  });

  let link;
  try {
    link = await razorpayService.createPaymentLink({ token: doc.publicToken, name: studentName, email: studentEmail, amountRupees: amount, course });
  } catch (e) {
    return res.status(502).json({ success: false, message: `Could not create the Razorpay payment link: ${e.message}` });
  }
  doc.razorpayPaymentLinkId = link.id;
  doc.razorpayShortUrl = link.short_url;

  const qr = await qrDataUrl(link.short_url);

  await doc.save();

  try {
    const sent = await sendPaymentLinkEmail({ email: studentEmail, name: studentName, course, amount, shortUrl: link.short_url, qrDataUrl: qr });
    doc.emailSent = (sent.sent || 0) > 0;
    doc.emailSentAt = doc.emailSent ? new Date() : undefined;
    if (!doc.emailSent && sent.skipped) doc.emailError = sent.skipped;
    await doc.save();
  } catch (e) {
    doc.emailError = e.message;
    await doc.save();
  }

  return res.status(200).json({
    success: true,
    result: {
      id: String(doc._id),
      publicToken: doc.publicToken,
      shortUrl: doc.razorpayShortUrl,
      qrDataUrl: qr,
      emailSent: doc.emailSent,
      emailError: doc.emailError || undefined,
      status: doc.status,
      amount: doc.amount,
      studentName: doc.studentName,
    },
  });
}

module.exports = create;
