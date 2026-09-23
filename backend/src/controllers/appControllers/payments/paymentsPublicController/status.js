const mongoose = require('mongoose');

// GET /api/payments/public/:token — no CRM auth; the token itself (a random
// 40-hex-char id, never the Mongo _id) is the credential. Powers the public
// KYC page: it polls this to know when the payment has cleared, and to show
// name/course/amount without needing them re-typed.
async function status(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const doc = await PaymentRequest.findOne({ publicToken: req.params.token, removed: false }).lean();
  if (!doc) return res.status(404).json({ success: false, message: 'Payment link not found.' });

  return res.status(200).json({
    success: true,
    result: {
      studentName: doc.studentName,
      course: doc.course,
      amount: doc.amount,
      status: doc.status,
      shortUrl: doc.razorpayShortUrl,
      kycSubmitted: doc.kycSubmitted,
      installmentNo: doc.installmentNo,
    },
  });
}

module.exports = status;
