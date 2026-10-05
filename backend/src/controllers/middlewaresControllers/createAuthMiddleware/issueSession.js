const jwt = require('jsonwebtoken');

// "Mobi" shows up in effectively every phone browser's UA string (Android,
// iPhone) — iPad's default Safari UA doesn't include it, so a tablet counts
// as a "desktop" device here, same bucket as a laptop.
function deviceCategory(userAgent) {
  return /Mobi/i.test(userAgent || '') ? 'mobile' : 'desktop';
}

// Shared by both ways of finishing a login — the normal OTP step
// (verifyOtp.js) and the direct email+password shortcut
// (loginWithPassword.js) — so a session created either way looks identical
// to the rest of the app (same token shape, same loggedSessions bookkeeping,
// same leftover-OTP cleanup).
async function issueSession({ user, UserPasswordModel, remember, req }) {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: remember ? 365 * 24 + 'h' : '24h',
  });

  // Students only: cap concurrent sessions at one mobile + one desktop/laptop
  // device at a time. Logging in again from a device in a category that
  // already has a session bumps that old session — isValidAuthToken.js
  // rejects any token no longer in loggedSessions, so the bumped device is
  // logged out (redirected to /logout) on its very next request.
  if (user.role === 'Student') {
    const category = deviceCategory(req && req.headers['user-agent']);
    const current = await UserPasswordModel.findOne({ user: user._id }, 'deviceSessions').lean();
    const stale = ((current && current.deviceSessions) || [])
      .filter((s) => s.deviceCategory === category)
      .map((s) => s.token);
    if (stale.length) {
      // $pull and $push can't touch the same array field in one update.
      await UserPasswordModel.updateOne(
        { user: user._id },
        { $pull: { loggedSessions: { $in: stale }, deviceSessions: { deviceCategory: category } } }
      ).exec();
    }
    await UserPasswordModel.findOneAndUpdate(
      { user: user._id },
      {
        $push: { loggedSessions: token, deviceSessions: { token, deviceCategory: category, issuedAt: new Date() } },
        $unset: { otpCode: '', otpSalt: '', otpExpires: '' },
      }
    ).exec();
    return token;
  }

  await UserPasswordModel.findOneAndUpdate(
    { user: user._id },
    { $push: { loggedSessions: token }, $unset: { otpCode: '', otpSalt: '', otpExpires: '' } }
  ).exec();

  return token;
}

module.exports = { issueSession };
