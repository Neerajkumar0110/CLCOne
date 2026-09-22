const QRCode = require('qrcode');

// A scannable QR that just encodes the Razorpay payment link URL — scanning
// it on a phone opens Razorpay's own hosted checkout, same as clicking the
// link. Returned as a data: URL so the admin tab can render it immediately
// (no separate file/route needed) and the same string can be attached to
// the email as an inline image.
async function qrDataUrl(url) {
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
}

module.exports = { qrDataUrl };
