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

// Used to independently re-verify the amount actually captured — the Payment
// Link callback_url redirect (verifyCallback below) only proves a payment_id
// exists and belongs to this link, never how much it was for, so a client
// that survived the redirect couldn't have paid a different amount, but
// nothing previously checked that this same amount matches what the CRM
// expected to charge.
async function fetchPayment(paymentId) {
  return client().payments.fetch(paymentId);
}

// Verifies a Razorpay webhook's raw-body HMAC signature (X-Razorpay-Signature
// header), per Razorpay's webhook docs — a separate secret from the API key,
// configured once in the Razorpay Dashboard's Webhooks section.
function verifyWebhookSignature(rawBody, signature) {
  if (!paymentsConfig.webhookSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', paymentsConfig.webhookSecret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch (e) {
    return false;
  }
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

// Spec §18 "health checks for ... payment gateway" — the admin system-health
// endpoint previously covered database/mailer/meetingProvider only, with
// nothing checking Razorpay reachability at all. A cheap, real API call
// (list at most 1 payment link) rather than just echoing "keys are set".
async function checkHealth() {
  if (!paymentsConfig.isConfigured) return { configured: false, reachable: false };
  try {
    await client().paymentLink.all({ count: 1 });
    return { configured: true, reachable: true };
  } catch (e) {
    return { configured: true, reachable: false, error: e.message };
  }
}

module.exports = { createPaymentLink, fetchPaymentLink, fetchPayment, verifyCallback, verifyWebhookSignature, checkHealth };
