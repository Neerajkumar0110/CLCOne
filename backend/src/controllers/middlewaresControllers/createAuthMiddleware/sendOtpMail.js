const { otpEmail } = require('../../../emailTemplate/otpEmail');
const { sendMailWithRetry } = require('../../../services/mail/transport');

const BRAND_NAME = 'Career Lab Consulting';

// Shares the one pooled Gmail transport with every other email in the app
// (services/mail/transport.js). Sharing matters beyond tidiness: a second
// transport is a second set of SMTP logins against the same Gmail account,
// and it was login volume — not message volume — that got the account
// throttled. An OTP is also the most latency-sensitive mail we send, so it
// benefits most from a connection that is already open and authenticated.
const sendOtpMail = async ({ email, name, otp }) => {
  await sendMailWithRetry({
    from: `"${process.env.GMAIL_SENDER_NAME || BRAND_NAME}" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: `${otp} is your ${BRAND_NAME} login code`,
    html: otpEmail({ name, otp, brand: BRAND_NAME, minutes: 10 }),
  });
};

module.exports = sendOtpMail;
