const mongoose = require('mongoose');
const { buildPlanSummary } = require('../../../../services/payments/plan');

// GET /api/payments/:id — admin detail view, includes the KYC submission
// (with document image paths) once submitted, plus — when this request is
// part of an EMI plan (see PaymentRequest.planGroupId) — a `plan` summary
// with the FULL 1..installmentCount schedule (not just the installments
// that already exist as their own PaymentRequest docs) and the remaining
// balance.
async function get(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const PaymentKyc = mongoose.model('PaymentKyc');

  const doc = await PaymentRequest.findOne({ _id: req.params.id, removed: false }).lean();
  if (!doc) return res.status(404).json({ success: false, message: 'Payment request not found.' });

  const kyc = doc.kycSubmitted ? await PaymentKyc.findOne({ paymentRequest: doc._id, removed: false }).lean() : null;

  let plan = null;
  if (doc.planGroupId) {
    const siblings = await PaymentRequest.find({ planGroupId: doc.planGroupId, removed: false })
      .sort({ installmentNo: 1 })
      .lean();
    plan = buildPlanSummary(doc, siblings);
  }

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
