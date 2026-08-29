const jwt = require('jsonwebtoken');
const { buildOAuthDialogUrl } = require('@/utils/linkedinAdsClient');

// Only the permissions this integration actually implements — r_ads to read
// ad accounts/campaigns, r_ads_leadgen_automation to read Lead Gen Forms and
// their responses (Lead Sync API), rw_ads to create campaign groups /
// campaigns / creatives. openid + profile + email are additive to the ads
// scopes so callback.js can identify the connecting LinkedIn member via
// getUserInfo() — the ads scopes alone don't grant access to that endpoint
// (see the comment on linkedinAdsClient.getUserInfo).
const SCOPE = ['r_ads', 'r_ads_leadgen_automation', 'rw_ads', 'openid', 'profile', 'email'].join(' ');

// GET /api/linkedin/connect (authenticated) — mints a short-lived `state`
// identifying the connecting admin (this app's frontend auth is
// bearer-token, not cookies, so the OAuth callback can't rely on
// session/auth middleware — state is how it knows who initiated the flow)
// and returns the LinkedIn OAuth dialog URL for the frontend to open in a
// popup. Mirrors facebookController/connect.js exactly.
const connect = async (req, res) => {
  if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_REDIRECT_URI) {
    // Not a server crash — this is expected until a real LinkedIn Developer
    // App exists and LINKEDIN_CLIENT_ID/LINKEDIN_CLIENT_SECRET are filled
    // into backend/.env.
    return res.status(400).json({
      success: false,
      result: null,
      message:
        "LinkedIn isn't configured yet — add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to backend/.env from a LinkedIn Developer App, then restart the server.",
    });
  }

  const state = jwt.sign({ adminId: req.admin._id, purpose: 'li-oauth' }, process.env.JWT_SECRET, {
    expiresIn: '10m',
  });

  const url = buildOAuthDialogUrl({
    redirectUri: process.env.LINKEDIN_REDIRECT_URI,
    state,
    scope: SCOPE,
  });

  return res.status(200).json({ success: true, result: { url }, message: 'LinkedIn OAuth URL generated' });
};

module.exports = connect;
