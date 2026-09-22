// Razorpay fee-collection config (Payments tab: payment link + QR, email,
// callback status sync, post-payment KYC form). Mirrors the shape of
// config/lms.js — nothing hardcoded outside this file, everything from env.

const { lmsConfig } = require('./lms');

const config = {
  keyId: process.env.RAZORPAY_KEY_ID || '',
  keySecret: process.env.RAZORPAY_KEY_SECRET || '',
  // Same public domain the LMS live-class links already use — this app's
  // frontend and backend are served from the same origin in production.
  crmBaseUrl: lmsConfig.meeting.crmBaseUrl,
};

config.isConfigured = !!(config.keyId && config.keySecret);

module.exports = { paymentsConfig: config };
