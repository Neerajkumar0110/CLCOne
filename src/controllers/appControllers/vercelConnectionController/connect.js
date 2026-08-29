const jwt = require('jsonwebtoken');
const { buildInstallUrl } = require('../../../utils/vercelClient');

// GET /api/vercel/connect (authenticated) — mints a short-lived `state`
// identifying the connecting admin (this app's frontend auth is bearer-token,
// not cookies, so the OAuth callback can't rely on session/auth middleware —
// state is how it knows who initiated the flow) and returns the Vercel
// installation URL for the frontend to open in a popup. Mirrors
// gitConnectionController/connect.js, adapted for Vercel's "external
// installation flow" (slug-identified, not client_id-in-URL).
const connect = async (req, res) => {
  if (!process.env.VERCEL_INTEGRATION_SLUG || !process.env.VERCEL_CLIENT_ID || !process.env.VERCEL_REDIRECT_URI) {
    return res.status(400).json({
      success: false,
      result: null,
      message:
        "Vercel isn't configured yet — create an Integration at vercel.com/dashboard/integrations/console and add VERCEL_INTEGRATION_SLUG, VERCEL_CLIENT_ID and VERCEL_CLIENT_SECRET to backend/.env, then restart the server.",
    });
  }

  const state = jwt.sign({ adminId: req.admin._id, purpose: 'vercel-oauth' }, process.env.JWT_SECRET, {
    expiresIn: '10m',
  });

  const url = buildInstallUrl({ state });

  return res.status(200).json({ success: true, result: { url }, message: 'Vercel install URL generated' });
};

module.exports = connect;
