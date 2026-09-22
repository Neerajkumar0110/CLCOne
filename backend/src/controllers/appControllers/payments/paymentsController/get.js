const mongoose = require('mongoose');

// GET /api/payments/:id — admin detail view, includes the KYC submission
// (with document image paths) once submitted.
async function get(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const PaymentKyc = mongoose.model('PaymentKyc');

  const doc = await PaymentRequest.findOne({ _id: req.params.id, removed: false }).lean();
  if (!doc) return res.status(404).json({ success: false, message: 'Payment request not found.' });

  const kyc = doc.kycSubmitted ? await PaymentKyc.findOne({ paymentRequest: doc._id, removed: false }).lean() : null;

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
