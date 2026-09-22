const mongoose = require('mongoose');

// GET /api/payments/:id — admin detail view, includes the KYC submission
// (with document image paths) once submitted, plus — when this request is
// part of an EMI plan (see PaymentRequest.planGroupId) — a `plan` summary
// with every sibling installment and the remaining balance.
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
    const paidSiblings = siblings.filter((s) => s.status === 'paid');
    const paidTotal = paidSiblings.reduce((sum, s) => sum + s.amount, 0);
    const planTotal = doc.planTotal || doc.amount;
    const remaining = Math.max(0, planTotal - paidTotal);
    const installmentsLeft = Math.max(0, doc.installmentCount - siblings.length);
    const latestPaid = paidSiblings.sort((a, b) => b.installmentNo - a.installmentNo)[0];

    plan = {
      installmentCount: doc.installmentCount,
      planTotal,
      paidTotal,
      remaining,
      nextInstallmentDueAt: latestPaid ? latestPaid.nextInstallmentDueAt : undefined,
      suggestedNextAmount: remaining > 0 ? Math.min(remaining, Math.round(planTotal / doc.installmentCount) || remaining) : 0,
      installmentsLeft,
      installments: siblings.map((s) => ({
        id: String(s._id),
        installmentNo: s.installmentNo,
        amount: s.amount,
        status: s.status,
        paidAt: s.paidAt,
      })),
    };
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
      emailError: doc.emailError,
      kycSubmitted: doc.kycSubmitted,
      created: doc.created,
      paidAt: doc.paidAt,
      installmentNo: doc.installmentNo,
      installmentCount: doc.installmentCount,
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
