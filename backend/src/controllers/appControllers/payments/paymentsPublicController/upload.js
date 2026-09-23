const mongoose = require('mongoose');

// POST /api/payments/public/:token/upload — multipart field "file" (see the
// singleStorageUpload middleware on the route). The returned path is then
// included in the final POST .../kyc submit. Gated the same way the KYC
// submit itself is: must be a real, paid, not-yet-submitted request —
// otherwise a stray upload just sits unused on disk.
//
// Auto-extracting Name/Father's Name/Address from the scan (tesseract.js)
// was tried and pulled back out — the free OCR's guesses were unreliable
// enough to do more harm than good. Left for a paid provider (Surepass/
// Cashfree/Deepvue/etc.) to revisit later; see services/payments/idOcr.js,
// still present but no longer called from here.
async function upload(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const doc = await PaymentRequest.findOne({ publicToken: req.params.token, removed: false }).lean();
  if (!doc) return res.status(404).json({ success: false, message: 'Payment link not found.' });
  if (doc.status !== 'paid') return res.status(409).json({ success: false, message: 'Payment not confirmed yet.' });
  if (doc.kycSubmitted) return res.status(409).json({ success: false, message: 'KYC already submitted.' });
  if (!req.file) return res.status(400).json({ success: false, message: 'No file received.' });

  return res.status(200).json({ success: true, result: { path: req.body.file } });
}

module.exports = upload;
