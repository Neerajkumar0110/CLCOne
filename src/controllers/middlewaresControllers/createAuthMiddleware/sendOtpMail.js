const nodemailer = require('nodemailer');
const { otpEmail } = require('../../../emailTemplate/otpEmail');

const BRAND_NAME = 'Career Lab Consulting';

// Reused across requests — creating a new SMTP connection per OTP would be wasteful.
let cachedTransporter = null;
function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return cachedTransporter;
}

const sendOtpMail = async ({ email, name, otp }) => {
  const transporter = getTransporter();

  await transporter.sendMail({
    from: `"${process.env.GMAIL_SENDER_NAME || BRAND_NAME}" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: `${otp} is your ${BRAND_NAME} login code`,
    html: otpEmail({ name, otp, brand: BRAND_NAME, minutes: 10 }),
  });
};

module.exports = sendOtpMail;
