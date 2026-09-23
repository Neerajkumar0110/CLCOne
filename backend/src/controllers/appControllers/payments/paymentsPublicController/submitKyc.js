const mongoose = require('mongoose');
const { notifyKycSubmitted } = require('../../../../services/payments/realtime');
const { createOrSyncStudentFromKyc } = require('../../../../services/payments/studentProvision');

// POST /api/payments/public/:token/kyc — JSON body with the text fields plus
// the 3 file paths already returned by upload.js (Aadhar front/back, PAN
// front only — no PAN back). Only allowed once per payment request, and
// only after the payment is actually confirmed paid.
async function submitKyc(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const PaymentKyc = mongoose.model('PaymentKyc');

  const doc = await PaymentRequest.findOne({ publicToken: req.params.token, removed: false });
  if (!doc) return res.status(404).json({ success: false, message: 'Payment link not found.' });
  if (doc.status !== 'paid') return res.status(409).json({ success: false, message: 'Payment not confirmed yet.' });
  if (doc.kycSubmitted) return res.status(409).json({ success: false, message: 'This form has already been submitted.' });

  const b = req.body || {};
  const required = ['name', 'fatherName', 'motherName', 'state', 'city', 'district', 'pincode', 'address'];
  const missingField = required.find((f) => !String(b[f] || '').trim());
  if (missingField) return res.status(400).json({ success: false, message: `Please fill in all fields.` });

  const requiredDocs = ['aadharFront', 'aadharBack', 'panFront'];
  const missingDoc = requiredDocs.find((f) => !String(b[f] || '').trim());
  if (missingDoc) return res.status(400).json({ success: false, message: 'Please upload all documents.' });

  const kyc = await PaymentKyc.create({
    paymentRequest: doc._id,
    name: String(b.name).trim(),
    fatherName: String(b.fatherName).trim(),
    motherName: String(b.motherName).trim(),
    state: String(b.state).trim(),
    city: String(b.city).trim(),
    district: String(b.district).trim(),
    pincode: String(b.pincode).trim(),
    address: String(b.address).trim(),
    aadharFront: String(b.aadharFront).trim(),
    aadharBack: String(b.aadharBack).trim(),
    panFront: String(b.panFront).trim(),
  });

  doc.kycSubmitted = true;
  doc.kycSubmittedAt = new Date();
  await doc.save();
  notifyKycSubmitted(doc);

  // Turns this KYC straight into an LMS Student roster row — real login,
  // enrollment email, the works (see studentProvision.js) — instead of
  // waiting on a staff member to notice and re-type it by hand. Best-effort:
  // the KYC submission itself must still succeed even if this fails.
  try {
    await createOrSyncStudentFromKyc(doc, kyc);
  } catch (e) {
    console.error('[payments] createOrSyncStudentFromKyc failed:', e && e.message);
  }

  return res.status(200).json({ success: true, result: { submitted: true } });
}

module.exports = submitKyc;
