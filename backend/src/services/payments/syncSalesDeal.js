const mongoose = require('mongoose');

// Fired the instant a PaymentRequest is actually confirmed paid (markPaid.js
// — the single choke point shared by the browser callback, the admin manual
// refresh and the real Razorpay webhook). Previously a real payment coming
// in never showed up anywhere in the Sales Pipeline/Deals tab at all — the
// two systems were completely disconnected, so Pipeline only ever reflected
// whatever someone happened to type into the Deals form by hand (which is
// to say: nothing, in practice).
//
// This auto-creates (or, for a later installment on the same enrollment,
// tops up) a "Closed Won" SalesDeal for the sales person who raised the
// payment request — so a real payment now automatically flows into the
// Pipeline's Won totals/table, attributed to whoever actually brought it in.
//
// Failure here must never break payment confirmation itself — the money has
// already landed by the time this runs — so every caller in markPaid.js
// invokes this fire-and-forget with .catch(), same as notifyPaid/
// syncStudentFees just above it.
async function syncSalesDealFromPayment(doc) {
  if (!doc || !doc.amount) return;

  const SalesDeal = mongoose.model('SalesDeal');
  // One deal per enrollment: an installment plan's later payments top up the
  // same deal (keyed by planGroupId); a one-off payment gets its own deal,
  // keyed by the PaymentRequest's own _id so a duplicate webhook/refresh
  // call (markPaid.js already de-dupes those, but this stays safe either way).
  const key = doc.planGroupId || String(doc._id);

  const existing = await SalesDeal.findOne({ paymentRequestPlanGroupId: key, removed: false });
  if (existing) {
    existing.amount = (existing.amount || 0) + doc.amount;
    existing.stage = 'Closed Won';
    existing.closeDate = doc.paidAt || new Date();
    existing.lastActivityDate = new Date();
    await existing.save();
    return;
  }

  await SalesDeal.create({
    title: `${doc.studentName}${doc.course ? ` — ${doc.course}` : ''}`,
    account: doc.studentName,
    contactEmail: doc.studentEmail || '',
    contactPhone: doc.studentPhone || '',
    stage: 'Closed Won',
    amount: doc.amount,
    currency: doc.currency || 'INR',
    closeDate: doc.paidAt || new Date(),
    lastActivityDate: new Date(),
    owner: doc.createdByName || '',
    source: 'Other',
    paymentRequestPlanGroupId: key,
  });
}

module.exports = { syncSalesDealFromPayment };
