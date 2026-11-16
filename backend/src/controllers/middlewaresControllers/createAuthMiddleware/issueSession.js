const jwt = require('jsonwebtoken');

const OWNER_MAX_SESSIONS = 10; // devices the owner can be logged in on at once

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

  // Owner (user ask 2026-11-16): may stay logged in on several devices at
  // once — a new login keeps the others (the 10 most recent sessions are
  // kept so the list can't grow forever; older ones are dropped and log out).
  if (user.role === 'owner') {
    await UserPasswordModel.findOneAndUpdate(
      { user: user._id },
      {
        $push: { loggedSessions: { $each: [token], $slice: -OWNER_MAX_SESSIONS } },
        $unset: { otpCode: '', otpSalt: '', otpExpires: '' },
      }
    ).exec();
    return token;
  }

  // Everyone else: ONE session at a time. A new login replaces every older
  // session, so the other device/browser is logged out — at once through
  // the socket (endOtherSessions), else on its next request (its token is
  // gone from loggedSessions → isValidAuthToken 401 → /logout). Tabs of the
  // same browser share the token, so they stay logged in.
  await UserPasswordModel.findOneAndUpdate(
    { user: user._id },
    { $set: { loggedSessions: [token], deviceSessions: [] }, $unset: { otpCode: '', otpSalt: '', otpExpires: '' } }
  ).exec();
  try {
    require('../../../socket').endOtherSessions(user._id, token);
  } catch (e) {
    /* no live socket server (serverless) — the next request logs them out */
  }

  return token;
}

module.exports = { issueSession };
