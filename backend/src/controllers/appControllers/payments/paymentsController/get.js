const mongoose = require('mongoose');
const { addMonths } = require('../../../../services/payments/plan');

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
    const paidSiblings = siblings.filter((s) => s.status === 'paid');
    const paidTotal = paidSiblings.reduce((sum, s) => sum + s.amount, 0);
    const planTotal = doc.planTotal || doc.amount;
    const remaining = Math.max(0, planTotal - paidTotal);
    const installmentsLeft = Math.max(0, doc.installmentCount - siblings.length);
    const latestPaid = paidSiblings.sort((a, b) => b.installmentNo - a.installmentNo)[0];

    // Only installments a PaymentRequest doc already exists for show up in
    // `siblings` — the rest of the plan hasn't been auto-created yet (see
    // jobs/financeEmiTick.js, which only spawns the next one 10 days before
    // it's due). Fill those gaps with a projected placeholder (evenly-split
    // amount, due date extrapolated one month at a time from the last known
    // due/paid date) so the schedule always shows all installmentCount rows
    // and which calendar month each one is/was for.
    const byNo = new Map(siblings.map((s) => [s.installmentNo, s]));
    const amountPerInstallment = Math.round(planTotal / doc.installmentCount) || 0;
    let cursorDue = null;
    const installments = [];
    for (let n = 1; n <= doc.installmentCount; n += 1) {
      const s = byNo.get(n);
      if (s) {
        installments.push({
          id: String(s._id),
          installmentNo: n,
          amount: s.amount,
          status: s.status,
          dueAt: s.dueAt,
          paidAt: s.paidAt,
          emailSent: s.emailSent,
          emailSentAt: s.emailSentAt,
          reminderCount: (s.reminderLog || []).length,
          projected: false,
        });
        cursorDue = s.status === 'paid' && s.paidAt ? addMonths(s.paidAt, 1) : s.dueAt ? addMonths(s.dueAt, 1) : cursorDue;
      } else {
        installments.push({
          id: null,
          installmentNo: n,
          amount: amountPerInstallment,
          status: 'upcoming',
          dueAt: cursorDue,
          paidAt: null,
          emailSent: false,
          emailSentAt: null,
          reminderCount: 0,
          projected: true,
        });
        if (cursorDue) cursorDue = addMonths(cursorDue, 1);
      }
    }

    plan = {
      installmentCount: doc.installmentCount,
      planTotal,
      paidTotal,
      remaining,
      nextInstallmentDueAt: latestPaid ? latestPaid.nextInstallmentDueAt : undefined,
      suggestedNextAmount: remaining > 0 ? Math.min(remaining, amountPerInstallment || remaining) : 0,
      installmentsLeft,
      installments,
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
