const mongoose = require('mongoose');
const { buildPlanSummary } = require('./plan');
const { GST_RATE } = require('./courseCatalog');

async function planForRequest(doc) {
  if (!doc.planGroupId) return null;
  const PaymentRequest = mongoose.model('PaymentRequest');
  const siblings = await PaymentRequest.find({ planGroupId: doc.planGroupId, removed: false })
    .sort({ installmentNo: 1 })
    .lean();
  return buildPlanSummary(doc, siblings);
}

function feeFieldsFromPlan(plan, doc) {
  const planTotal = plan ? plan.planTotal : doc.amount;
  // A one-off (non-plan) request only ever reaches this point once it's
  // paid — submitKyc.js gates the whole KYC form on doc.status === 'paid'.
  const paidTotal = plan ? plan.paidTotal : doc.amount;
  const feeDue = Math.max(0, planTotal - paidTotal);
  return {
    feeTotal: Math.round(planTotal / (1 + GST_RATE)),
    feeGrandTotal: planTotal,
    feePaid: paidTotal,
    feeDue,
    feeStatus: feeDue <= 0 ? 'Paid' : paidTotal > 0 ? 'Partial' : 'Unpaid',
  };
}

// Fired the instant a candidate's KYC lands (paymentsPublicController/
// submitKyc.js) — this used to be a fully manual step (staff re-typing the
// same candidate into the LMS -> Students tab once they noticed the KYC
// modal). Creating the Student row here means it also gets a real CRM login
// and the enrollment email for free, via Student.js's existing post-save
// hook (services/lms/studentAccountService.js) — nothing else changes about
// that path, this just triggers it automatically instead of waiting on a
// human. A second installment's KYC (shouldn't normally happen — KYC is a
// once-per-enrollment step) or a candidate who already has a roster row
// under this email just gets its fee figures refreshed, no duplicate login
// or email.
async function createOrSyncStudentFromKyc(paymentRequestDoc, kycDoc) {
  const email = String(paymentRequestDoc.studentEmail || '').trim().toLowerCase();
  if (!email) return null;

  const Student = mongoose.model('Student');
  const plan = await planForRequest(paymentRequestDoc);
  const fields = {
    name: (kycDoc && kycDoc.name) || paymentRequestDoc.studentName,
    email,
    phone: paymentRequestDoc.studentPhone || '',
    city: (kycDoc && kycDoc.city) || '',
    course: paymentRequestDoc.course || '',
    source: 'Website',
    paymentRequest: paymentRequestDoc._id,
    ...feeFieldsFromPlan(plan, paymentRequestDoc),
  };

  const existing = await Student.findOne({ email, removed: false });
  let student;
  if (existing) {
    Object.assign(existing, fields);
    if (!existing.status) existing.status = 'Active';
    if (!existing.enrolledOn) existing.enrolledOn = new Date();
    student = await existing.save();
  } else {
    student = await new Student({ ...fields, status: 'Active', enrolledOn: new Date() }).save();
  }

  const PaymentRequest = mongoose.model('PaymentRequest');
  await PaymentRequest.updateOne({ _id: paymentRequestDoc._id }, { $set: { student: student._id } });

  return student;
}

// Keeps an already-created Student row's fee snapshot (Students tab, "My
// Fees" panel) matching reality after a *later* EMI installment gets paid —
// called fire-and-forget from paymentsController/refreshStatus.js and
// paymentsPublicController/return.js, right next to financeHold.js's
// unblockIfClear (same trigger point, same best-effort style). No-op for a
// candidate who never reached the "Student row exists" stage.
async function syncStudentFees(studentEmail) {
  const email = String(studentEmail || '').trim().toLowerCase();
  if (!email) return;

  const Student = mongoose.model('Student');
  const PaymentRequest = mongoose.model('PaymentRequest');
  const student = await Student.findOne({ email, removed: false, paymentRequest: { $ne: null } });
  if (!student) return;

  const doc = await PaymentRequest.findOne({ _id: student.paymentRequest, removed: false }).lean();
  if (!doc) return;

  const plan = await planForRequest(doc);
  Object.assign(student, feeFieldsFromPlan(plan, doc));
  await student.save();
}

module.exports = { createOrSyncStudentFromKyc, syncStudentFees, planForRequest };
