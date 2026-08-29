const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const graph = require('@/utils/metaGraphClient');
const tokenCrypto = require('@/utils/metaTokenCrypto');
const { findConnection } = require('./_helpers');

// Renders a tiny self-closing page that hands the result back to the SPA
// window that opened this OAuth popup via postMessage, then closes itself.
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

// GET /public/facebook/callback?code&state — Meta redirects the OAuth popup
// here directly (no bearer token attached, it's a browser navigation), so
// this route lives under /public and trusts the signed `state` instead.
const callback = async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return popupResponsePage(res, { type: 'fb-oauth-error', message: error_description || error });
  }

  let decoded;
  try {
    decoded = jwt.verify(state, process.env.JWT_SECRET);
  } catch (err) {
    return popupResponsePage(res, { type: 'fb-oauth-error', message: 'Invalid or expired OAuth state.' });
  }

  if (decoded.purpose !== 'fb-oauth') {
    return popupResponsePage(res, { type: 'fb-oauth-error', message: 'Invalid OAuth state.' });
  }

  try {
    const Admin = mongoose.model('Admin');
    const FacebookConnection = mongoose.model('FacebookConnection');

    const admin = await Admin.findOne({ _id: decoded.adminId, removed: false }).exec();
    if (!admin) throw new Error('Connecting admin not found.');

    const shortLived = await graph.exchangeCodeForToken({
      code,
      redirectUri: process.env.META_REDIRECT_URI,
    });
    const longLived = await graph.exchangeForLongLivedToken(shortLived.access_token);
    const me = await graph.getMe(longLived.access_token);

    const expiresAt = longLived.expires_in
      ? new Date(Date.now() + longLived.expires_in * 1000)
      : undefined;

    let conn = await findConnection();
    if (!conn) conn = new FacebookConnection({});

    conn.metaUserId = me.id;
    conn.metaUserName = me.name;
    conn.userAccessToken = tokenCrypto.encrypt(longLived.access_token);
    conn.tokenExpiresAt = expiresAt;
    conn.status = 'connected';
    conn.connectedBy = admin.name;
    conn.lastError = undefined;
    conn.updated = Date.now();
    await conn.save();

    return popupResponsePage(res, { type: 'fb-oauth-success' });
  } catch (err) {
    return popupResponsePage(res, { type: 'fb-oauth-error', message: err.message });
  }
};

module.exports = callback;
