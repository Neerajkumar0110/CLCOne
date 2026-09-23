const jwt = require('jsonwebtoken');

// Shared by both ways of finishing a login — the normal OTP step
// (verifyOtp.js) and the direct email+password shortcut
// (loginWithPassword.js) — so a session created either way looks identical
// to the rest of the app (same token shape, same loggedSessions bookkeeping,
// same leftover-OTP cleanup).
async function issueSession({ user, UserPasswordModel, remember }) {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: remember ? 365 * 24 + 'h' : '24h',
  });

  await UserPasswordModel.findOneAndUpdate(
    { user: user._id },
    { $push: { loggedSessions: token }, $unset: { otpCode: '', otpSalt: '', otpExpires: '' } }
  ).exec();

  return token;
}

module.exports = { issueSession };
