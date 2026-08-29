const jwt = require('jsonwebtoken');
const { buildOAuthDialogUrl } = require('@/utils/googleAdsClient');

// adwords manages campaigns; openid+email are required too — callback.js
// calls Google's userinfo endpoint right after the token exchange to identify
// the connecting Google account, and that endpoint rejects a token scoped to
// adwords alone with "Invalid Credentials" (no save ever happens in that case,
// since the failure is before conn.save() in callback.js).
const SCOPE = 'https://www.googleapis.com/auth/adwords openid email';

// GET /api/google/connect (authenticated) — mints a short-lived `state`
// identifying the connecting admin (this app's frontend auth is bearer-token,
// not cookies, so the OAuth callback can't rely on session/auth middleware —
// state is how it knows who initiated the flow) and returns the Google OAuth
// dialog URL for the frontend to open in a popup.
const connect = async (req, res) => {
  if (!process.env.GOOGLE_ADS_CLIENT_ID || !process.env.GOOGLE_ADS_REDIRECT_URI) {
    // Not a server crash — this is expected until a real Google Cloud OAuth
    // client exists and GOOGLE_ADS_CLIENT_ID/GOOGLE_ADS_CLIENT_SECRET are
    // filled into backend/.env.
    return res.status(400).json({
      success: false,
      result: null,
      message:
        "Google Ads isn't configured yet — add GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET to backend/.env from a Google Cloud OAuth client, then restart the server.",
    });
  }

  const state = jwt.sign({ adminId: req.admin._id, purpose: 'google-oauth' }, process.env.JWT_SECRET, {
    expiresIn: '10m',
  });

  const url = buildOAuthDialogUrl({
    redirectUri: process.env.GOOGLE_ADS_REDIRECT_URI,
    state,
    scope: SCOPE,
  });

  return res.status(200).json({ success: true, result: { url }, message: 'Google Ads OAuth URL generated' });
};

module.exports = connect;
