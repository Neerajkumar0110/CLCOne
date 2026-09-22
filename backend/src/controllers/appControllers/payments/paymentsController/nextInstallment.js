const mongoose = require('mongoose');
const { createLinkForRequest } = require('../../../../services/payments/createLinkForRequest');
const { paymentsConfig } = require('../../../../config/payments');

// POST /api/payments/:id/next-installment — collect another EMI payment
// against an existing plan (see PaymentRequest.planGroupId). `:id` can be
// any installment already belonging to the plan; the student/course/plan
// details are copied from it so the admin only has to type an amount —
// typically the modal's suggested next-installment amount, but any figure
// is accepted (partial top-up or paying off the rest in one go). Creates a
// fresh Razorpay Payment Link + QR + email, same as paymentsController/create.
async function nextInstallment(req, res) {
  if (!paymentsConfig.isConfigured) {
    return res.status(503).json({ success: false, message: 'Razorpay is not configured on the server.' });
  }
  const PaymentRequest = mongoose.model('PaymentRequest');
  const source = await PaymentRequest.findOne({ _id: req.params.id, removed: false }).lean();
  if (!source) return res.status(404).json({ success: false, message: 'Payment request not found.' });
  if (!source.planGroupId) {
    return res.status(400).json({ success: false, message: 'This payment is not part of an installment plan.' });
  }

  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Enter a valid amount.' });

  const installmentNo = (await PaymentRequest.countDocuments({ planGroupId: source.planGroupId, removed: false })) + 1;

  const doc = new PaymentRequest({
    studentName: source.studentName,
    studentEmail: source.studentEmail,
    studentPhone: source.studentPhone,
    course: source.course,
    amount,
    notes: source.notes,
    createdBy: req.admin._id,
    createdByName: req.admin.name,
    planGroupId: source.planGroupId,
    installmentNo,
    installmentCount: source.installmentCount,
    planTotal: source.planTotal,
    // Carries the automatic reminder/overdue-block schedule over even when
    // the admin manually collects early instead of waiting for the cron
    // (jobs/financeEmiTick.js) to auto-create it at the 10-day mark.
    dueAt: source.nextInstallmentDueAt || undefined,
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

module.exports = nextInstallment;
