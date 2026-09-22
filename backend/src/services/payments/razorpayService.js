const crypto = require('crypto');
const Razorpay = require('razorpay');
const { paymentsConfig } = require('../../config/payments');

let _client = null;
function client() {
  if (!paymentsConfig.isConfigured) throw new Error('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).');
  if (!_client) _client = new Razorpay({ key_id: paymentsConfig.keyId, key_secret: paymentsConfig.keySecret });
  return _client;
}

// One Payment Link per PaymentRequest. `callback_url` is where Razorpay
// redirects the student's browser after paying — signed with the key
// secret (verifyCallback below), so that redirect alone is enough to
// confirm the payment server-side without needing a separately-configured
// Dashboard webhook.
async function createPaymentLink({ token, name, email, amountRupees, course, notes }) {
  const payload = {
    amount: Math.round(Number(amountRupees) * 100), // paise
    currency: 'INR',
    accept_partial: false,
    description: course ? `Fee payment — ${course}` : 'Fee payment',
    customer: { name, email },
    notify: { sms: false, email: false }, // the CRM sends its own branded email
    reminder_enable: true,
    reference_id: token,
    callback_url: `${paymentsConfig.crmBaseUrl}/api/payments/public/return?token=${token}`,
    callback_method: 'get',
    notes: { publicToken: token, course: course || '', ...(notes || {}) },
  };
  const link = await client().paymentLink.create(payload);
  return link; // { id, short_url, status, ... }
}

async function fetchPaymentLink(razorpayPaymentLinkId) {
  return client().paymentLink.fetch(razorpayPaymentLinkId);
}

// Verifies a Payment Link's callback_url query params, per Razorpay's docs:
// signature = HMAC_SHA256(link_id|reference_id|link_status|payment_id, key_secret)
function verifyCallback(query = {}) {
  const { razorpay_payment_link_id, razorpay_payment_link_reference_id, razorpay_payment_link_status, razorpay_payment_id, razorpay_signature } = query;
  if (!razorpay_payment_link_id || !razorpay_payment_link_status || !razorpay_payment_id || !razorpay_signature) return false;
  const payload = `${razorpay_payment_link_id}|${razorpay_payment_link_reference_id || ''}|${razorpay_payment_link_status}|${razorpay_payment_id}`;
  const expected = crypto.createHmac('sha256', paymentsConfig.keySecret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(razorpay_signature)));
  } catch (e) {
    return false;
  }
}

module.exports = { createPaymentLink, fetchPaymentLink, verifyCallback };
