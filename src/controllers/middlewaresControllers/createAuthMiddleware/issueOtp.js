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

  // Filter mirrors verifyOtp / resendOtp ({ user, removed: false }) so all
  // three always act on the same document. `new: true` lets us confirm the
  // write actually landed — if the account has no password record the
  // update matches nothing, and we must NOT email a code that verifyOtp
  // could never match (that produced the "enter code → always rejected"
  // loop). Failing here surfaces the real problem instead.
  const updated = await UserPasswordModel.findOneAndUpdate(
    { user: user._id, removed: false },
    { otpCode, otpSalt, otpExpires: new Date(Date.now() + OTP_TTL_MS) },
    { new: true }
  ).exec();

  if (!updated) {
    throw new Error(`No password record for user ${user._id} — cannot issue a login code.`);
  }

  await sendOtpMail({ email: user.email, name: user.name, otp });
};

module.exports = { issueOtp, OTP_TTL_MS };
