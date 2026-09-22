const { lookupCourseFee } = require('../../../../services/payments/courseCatalog');

// GET /api/payments/course-fee?course=... — lets the "New payment request"
// form auto-fill Amount with the first EMI installment and show the fee
// breakdown for a known course plan (see courseCatalog.js). `result` is
// null for any course not in the catalog — the admin just types an amount
// manually, exactly as before.
async function courseFee(req, res) {
  const fee = lookupCourseFee(req.query.course);
  return res.status(200).json({ success: true, result: fee });
}

module.exports = courseFee;
