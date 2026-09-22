const mongoose = require('mongoose');
const { createLinkForRequest } = require('../../../../services/payments/createLinkForRequest');
const { lookupCourseFee } = require('../../../../services/payments/courseCatalog');
const { paymentsConfig } = require('../../../../config/payments');

// POST /api/payments — admin creates a fee-collection request: a Razorpay
// Payment Link, a QR encoding it (returned inline for the admin tab), and a
// best-effort email to the student with both. When `course` matches a known
// fee plan (see courseCatalog.js) this is treated as the plan's first
// installment — it gets its own `planGroupId` so later installments
// (paymentsController/nextInstallment.js) can be tied back to it and the
// remaining balance computed.
async function create(req, res) {
  if (!paymentsConfig.isConfigured) {
    return res.status(503).json({ success: false, message: 'Razorpay is not configured on the server.' });
  }
  const b = req.body || {};
  const studentName = String(b.studentName || '').trim();
  const studentEmail = String(b.studentEmail || '').trim().toLowerCase();
  const studentPhone = String(b.studentPhone || '').trim();
  const amount = Number(b.amount);
  const course = String(b.course || '').trim();
  const notes = String(b.notes || '').trim();

  if (!studentName) return res.status(400).json({ success: false, message: 'Student name is required.' });
  if (!/.+@.+\..+/.test(studentEmail)) return res.status(400).json({ success: false, message: 'A valid student email is required.' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Enter a valid amount.' });

  const fee = lookupCourseFee(course);

  const PaymentRequest = mongoose.model('PaymentRequest');
  const doc = new PaymentRequest({
    studentName,
    studentEmail,
    studentPhone,
    course,
    amount,
    notes,
    createdBy: req.admin._id,
    createdByName: req.admin.name,
    installmentNo: 1,
    installmentCount: fee ? fee.durationMonths : 1,
    planTotal: fee ? fee.totalFee : amount,
    planGroupId: fee ? new mongoose.Types.ObjectId().toString() : undefined,
  });

  let qr;
  try {
    qr = await createLinkForRequest(doc);
  } catch (e) {
    return res.status(502).json({ success: false, message: `Could not create the Razorpay payment link: ${e.message}` });
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
      installmentNo: doc.installmentNo,
      installmentCount: doc.installmentCount,
      planTotal: doc.planTotal,
    },
  });
}

module.exports = create;
