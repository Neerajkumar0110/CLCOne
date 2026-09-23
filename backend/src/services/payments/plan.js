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

// Full 1..installmentCount schedule for one enrollment's plan — `siblings`
// is every PaymentRequest doc that already exists for this planGroupId
// (installments not yet auto-created, see jobs/financeEmiTick.js, are
// filled in as `projected: true` placeholders with an evenly-split amount
// and a due date extrapolated one month at a time). Shared by the admin
// payment detail modal (paymentsController/get.js), the student "My Fees"
// panel, and the enrollment-receipt email/PDF, so all three always agree on
// what's paid, what's due, and which calendar month each installment is for.
function buildPlanSummary(doc, siblings) {
  const paidSiblings = siblings.filter((s) => s.status === 'paid');
  const paidTotal = paidSiblings.reduce((sum, s) => sum + s.amount, 0);
  const planTotal = doc.planTotal || doc.amount;
  const remaining = Math.max(0, planTotal - paidTotal);
  const installmentsLeft = Math.max(0, doc.installmentCount - siblings.length);
  const latestPaid = paidSiblings.sort((a, b) => b.installmentNo - a.installmentNo)[0];

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

  return {
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

module.exports = { addMonths, stampNextInstallmentDue, buildPlanSummary };
