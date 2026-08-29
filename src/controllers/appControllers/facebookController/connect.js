const jwt = require('jsonwebtoken');
const { buildOAuthDialogUrl } = require('../../../utils/metaGraphClient');

// Only the permissions this integration actually implements — pages_show_list
// + pages_read_engagement to list Pages, pages_manage_ads + pages_manage_metadata
// + leads_retrieval to create lead forms / read leads / subscribe webhooks,
// ads_management + business_management for campaign/adset/creative/ad creation.
const SCOPE = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_ads',
  'pages_manage_metadata',
  'leads_retrieval',
  'ads_management',
  'business_management',
].join(',');

// GET /api/facebook/connect (authenticated) — mints a short-lived `state`
// identifying the connecting admin (this app's frontend auth is bearer-token,
// not cookies, so the OAuth callback can't rely on session/auth middleware —
// state is how it knows who initiated the flow) and returns the Meta OAuth
// dialog URL for the frontend to open in a popup.
const connect = async (req, res) => {
  if (!process.env.META_APP_ID || !process.env.META_REDIRECT_URI) {
    // Not a server crash — this is expected until a real Meta Developer App
    // exists and META_APP_ID/META_APP_SECRET are filled into backend/.env.
    return res.status(400).json({
      success: false,
      result: null,
      message: 'Facebook isn\'t configured yet — add META_APP_ID and META_APP_SECRET to backend/.env from a Meta Developer App, then restart the server.',
    });
  }

  const state = jwt.sign({ adminId: req.admin._id, purpose: 'fb-oauth' }, process.env.JWT_SECRET, {
    expiresIn: '10m',
  });

  const url = buildOAuthDialogUrl({
    redirectUri: process.env.META_REDIRECT_URI,
    state,
    scope: SCOPE,
  });

  return res.status(200).json({ success: true, result: { url }, message: 'Facebook OAuth URL generated' });
};

module.exports = connect;
