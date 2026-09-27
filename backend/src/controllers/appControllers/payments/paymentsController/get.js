const mongoose = require('mongoose');
const { buildPlanSummary } = require('../../../../services/payments/plan');
const { qrDataUrl } = require('../../../../services/payments/qr');
const { paymentScopeFilter } = require('./scope');

// GET /api/payments/:id — admin detail view, includes the KYC submission
// (with document image paths) once submitted, plus — when this request is
// part of an EMI plan (see PaymentRequest.planGroupId) — a `plan` summary
// with the FULL 1..installmentCount schedule (not just the installments
// that already exist as their own PaymentRequest docs) and the remaining
// balance.
async function get(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const PaymentKyc = mongoose.model('PaymentKyc');

  // Row-level visibility — same rule as list.js (see scope.js). A
  // non-full-access caller can't fetch another admin's payment request
  // directly by id even knowing/guessing it (unless it's a teammate's and
  // they're currently in "My Team" view — same ?teamView=1 the list uses).
  const scopeFilter = await paymentScopeFilter(req.admin, req);
  const doc = await PaymentRequest.findOne({ _id: req.params.id, removed: false, ...scopeFilter }).lean();
  if (!doc) return res.status(404).json({ success: false, message: 'Payment request not found.' });

  const kyc = doc.kycSubmitted ? await PaymentKyc.findOne({ paymentRequest: doc._id, removed: false }).lean() : null;

  let plan = null;
  if (doc.planGroupId) {
    const siblings = await PaymentRequest.find({ planGroupId: doc.planGroupId, removed: false })
      .sort({ installmentNo: 1 })
      .lean();
    plan = buildPlanSummary(doc, siblings);
  }

  // The QR create.js returns is a one-time thing — nothing persists the
  // image itself, only the Razorpay short URL it encodes. Regenerating it
  // here (same qr.js encoder, purely local/no Razorpay call) means the QR
  // is viewable again any time after creation, not just in the moment right
  // after — e.g. an admin opening a payment request a sales person raised
  // earlier previously had no way to see its QR at all.
  const qr = doc.razorpayShortUrl ? await qrDataUrl(doc.razorpayShortUrl) : null;

  return res.status(200).json({
    success: true,
    result: {
      id: String(doc._id),
      publicToken: doc.publicToken,
      studentName: doc.studentName,
      studentEmail: doc.studentEmail,
      course: doc.course,
      amount: doc.amount,
      notes: doc.notes,
      status: doc.status,
      shortUrl: doc.razorpayShortUrl,
      qrDataUrl: qr,
      razorpayPaymentId: doc.razorpayPaymentId,
      emailSent: doc.emailSent,
      emailSentAt: doc.emailSentAt,
      emailError: doc.emailError,
      kycSubmitted: doc.kycSubmitted,
      created: doc.created,
      createdByName: doc.createdByName,
      paidAt: doc.paidAt,
      dueAt: doc.dueAt,
      installmentNo: doc.installmentNo,
      installmentCount: doc.installmentCount,
      reminderLog: doc.reminderLog || [],
      plan,
      kyc: kyc
        ? {
            name: kyc.name,
            fatherName: kyc.fatherName,
            motherName: kyc.motherName,
            state: kyc.state,
            city: kyc.city,
            district: kyc.district,
            pincode: kyc.pincode,
            address: kyc.address,
            aadharFront: kyc.aadharFront,
            aadharBack: kyc.aadharBack,
            panFront: kyc.panFront,
            panBack: kyc.panBack,
            created: kyc.created,
          }
        : null,
    },
  });
}

module.exports = get;
