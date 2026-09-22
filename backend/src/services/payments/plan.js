// Calendar-month arithmetic for EMI due dates: "the next installment is due
// one month from the day this one was paid". Clamps into a shorter target
// month instead of overflowing (Jan 31 + 1 month -> Feb 28/29, not Mar 3).
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const daysInTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTarget));
  return d;
}

// Call right after setting doc.status='paid'/doc.paidAt on a PaymentRequest
// that's part of an installment plan — stamps when the next installment
// becomes due, or leaves it unset if this was the last one.
function stampNextInstallmentDue(doc) {
  if (doc.installmentCount > 1 && doc.installmentNo < doc.installmentCount) {
    doc.nextInstallmentDueAt = addMonths(doc.paidAt || new Date(), 1);
  }
}

module.exports = { addMonths, stampNextInstallmentDue };
