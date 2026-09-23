const mongoose = require('mongoose');
const path = require('path');
const { ocrText, parsePan, parseAadhar } = require('../../../../services/payments/idOcr');

// POST /api/payments/public/:token/upload — multipart field "file" (see the
// singleStorageUpload middleware on the route), plus a plain text field
// "docType" (aadharFront/aadharBack/panFront) the frontend sends alongside
// it. The returned path is then included in the final POST .../kyc submit.
// Gated the same way the KYC submit itself is: must be a real, paid,
// not-yet-submitted request — otherwise a stray upload just sits unused on
// disk.
//
// For the two "front" scans (they're the ones that actually carry printed
// text), best-effort OCRs the image and returns whatever fields could be
// guessed (services/payments/idOcr.js) so the form can pre-fill — never
// authoritative, the candidate still reviews/edits every field.
async function upload(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const doc = await PaymentRequest.findOne({ publicToken: req.params.token, removed: false }).lean();
  if (!doc) return res.status(404).json({ success: false, message: 'Payment link not found.' });
  if (doc.status !== 'paid') return res.status(409).json({ success: false, message: 'Payment not confirmed yet.' });
  if (doc.kycSubmitted) return res.status(409).json({ success: false, message: 'KYC already submitted.' });
  if (!req.file) return res.status(400).json({ success: false, message: 'No file received.' });

  const result = { path: req.body.file };

  const docType = String(req.body.docType || '');
  if (docType === 'panFront' || docType === 'aadharFront') {
    try {
      const text = await ocrText(path.resolve(req.file.path));
      result.extracted = docType === 'panFront' ? parsePan(text) : parseAadhar(text);
    } catch (e) {
      result.extracted = null; // OCR failure never blocks the upload itself
    }
  }

  return res.status(200).json({ success: true, result });
}

module.exports = upload;
