const GST_RATE = 0.18;

// Known fee plans — `baseFee` excludes GST, `durationMonths` is both the
// plan's advertised length and the number of equal monthly EMI installments
// its GST-inclusive total is split into. Extend this list for new plans;
// any course not matched here behaves exactly as before (admin types a
// plain one-off amount, no installment tracking).
const CATALOG = [
  { match: /internx-ai.*foundation plan/i, baseFee: 120000, durationMonths: 6 },
  { match: /internx-ai.*elite plan/i, baseFee: 200000, durationMonths: 12 },
];

function lookupCourseFee(course) {
  const name = String(course || '');
  const hit = CATALOG.find((c) => c.match.test(name));
  if (!hit) return null;
  const totalFee = Math.round(hit.baseFee * (1 + GST_RATE));
  const gstAmount = totalFee - hit.baseFee;
  const installmentAmount = Math.round(totalFee / hit.durationMonths);
  return { baseFee: hit.baseFee, gstAmount, totalFee, durationMonths: hit.durationMonths, installmentAmount };
}

module.exports = { lookupCourseFee, GST_RATE };
