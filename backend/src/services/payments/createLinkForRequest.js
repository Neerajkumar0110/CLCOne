const razorpayService = require('./razorpayService');
const { qrDataUrl } = require('./qr');
const { sendPaymentLinkEmail } = require('./mailer');

// Shared by paymentsController/create.js (first installment / one-off
// payment) and paymentsController/nextInstallment.js (continuing an existing
// plan): generates the Razorpay Payment Link + QR for an already-constructed
// (not yet saved) `doc`, saves it, and best-effort emails the student.
// Mutates and saves `doc`; returns the QR data URL.
async function createLinkForRequest(doc) {
  const link = await razorpayService.createPaymentLink({
    token: doc.publicToken,
    name: doc.studentName,
    email: doc.studentEmail,
    amountRupees: doc.amount,
    course: doc.course,
  });
  doc.razorpayPaymentLinkId = link.id;
  doc.razorpayShortUrl = link.short_url;

  const qr = await qrDataUrl(link.short_url);
  await doc.save();

  try {
    const sent = await sendPaymentLinkEmail({
      email: doc.studentEmail,
      name: doc.studentName,
      course: doc.course,
      amount: doc.amount,
      shortUrl: link.short_url,
      qrDataUrl: qr,
    });
    doc.emailSent = (sent.sent || 0) > 0;
    doc.emailSentAt = doc.emailSent ? new Date() : undefined;
    if (!doc.emailSent && sent.skipped) doc.emailError = sent.skipped;
  } catch (e) {
    doc.emailError = e.message;
  }
  await doc.save();

  return qr;
}

module.exports = { createLinkForRequest };
