const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const sendOtpMail = require('./sendOtpMail');

const OTP_TTL_MS = 10 * 60 * 1000;

// Generates a 6-digit code, hashes + stores it against the user's password
// record, and emails it. Shared by the initial login step and "resend code".
const issueOtp = async ({ user, UserPasswordModel }) => {
  const otp = crypto.randomInt(100000, 1000000).toString();
  const otpSalt = crypto.randomBytes(8).toString('hex');
  const otpCode = bcrypt.hashSync(otpSalt + otp);

  await UserPasswordModel.findOneAndUpdate(
    { user: user._id },
    { otpCode, otpSalt, otpExpires: new Date(Date.now() + OTP_TTL_MS) }
  ).exec();

  await sendOtpMail({ email: user.email, name: user.name, otp });
};

module.exports = { issueOtp, OTP_TTL_MS };
