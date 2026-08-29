const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const vercel = require('@/utils/vercelClient');
const tokenCrypto = require('@/utils/vercelTokenCrypto');
const { findConnection } = require('./_helpers');

// Renders a tiny self-closing page that hands the result back to the SPA
// window that opened this OAuth popup via postMessage, then closes itself.
// Mirrors gitConnectionController/callback.js.
function popupResponsePage(res, payload) {
  const appUrl = process.env.APP_URL || '*';
  const html = `<!doctype html><html><body>
<script>
  if (window.opener) {
    window.opener.postMessage(${JSON.stringify(payload)}, ${JSON.stringify(appUrl)});
  }
  window.close();
</script>
<p>You can close this window.</p>
</body></html>`;
  res.status(200).set('Content-Type', 'text/html').send(html);
}

// GET /public/vercel/callback?code&teamId&configurationId&state — Vercel
// redirects the install popup here directly (no bearer token attached),
// per the "external installation flow" contract — so this route lives under
// /public and trusts the signed `state` instead.
const callback = async (req, res) => {
  const { code, teamId, configurationId, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return popupResponsePage(res, { type: 'vercel-oauth-error', message: errorDescription || error });
  }

  let decoded;
  try {
    decoded = jwt.verify(state, process.env.JWT_SECRET);
  } catch (err) {
    return popupResponsePage(res, { type: 'vercel-oauth-error', message: 'Invalid or expired install state.' });
  }

  if (decoded.purpose !== 'vercel-oauth') {
    return popupResponsePage(res, { type: 'vercel-oauth-error', message: 'Invalid install state.' });
  }

  try {
    const Admin = mongoose.model('Admin');
    const VercelConnection = mongoose.model('VercelConnection');

    const admin = await Admin.findOne({ _id: decoded.adminId, removed: false }).exec();
    if (!admin) throw new Error('Connecting admin not found.');

    const tokens = await vercel.exchangeCodeForToken({
      code,
      redirectUri: process.env.VERCEL_REDIRECT_URI,
    });

    const me = await vercel.getAuthenticatedUser(tokens.access_token);

    let conn = await findConnection(admin._id);
    if (!conn) conn = new VercelConnection({ admin: admin._id });

    conn.vercelUserId = me.uid || me.id;
    conn.vercelUsername = me.username || me.name;
    conn.vercelEmail = me.email;
    conn.vercelAvatarUrl = me.avatar ? `https://vercel.com/api/www/avatar/${me.avatar}` : undefined;
    conn.teamId = teamId || undefined;
    conn.configurationId = configurationId;
    conn.accessToken = tokenCrypto.encrypt(tokens.access_token);
    conn.status = 'connected';
    conn.lastError = undefined;
    conn.updated = Date.now();
    await conn.save();

    return popupResponsePage(res, { type: 'vercel-oauth-success' });
  } catch (err) {
    return popupResponsePage(res, { type: 'vercel-oauth-error', message: err.message });
  }
};

module.exports = callback;
