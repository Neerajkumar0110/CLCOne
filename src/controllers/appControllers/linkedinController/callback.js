const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const client = require('../../../utils/linkedinAdsClient');
const tokenCrypto = require('../../../utils/linkedinTokenCrypto');
const { findConnection } = require('./_helpers');

// Renders a tiny self-closing page that hands the result back to the SPA
// window that opened this OAuth popup via postMessage, then closes itself.
// Mirrors facebookController/callback.js's popupResponsePage exactly.
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

// GET /public/linkedin/callback?code&state — LinkedIn redirects the OAuth
// popup here directly (no bearer token attached, it's a browser
// navigation), so this route lives under /public and trusts the signed
// `state` instead. Mirrors facebookController/callback.js exactly, with two
// real differences: LinkedIn's token exchange is form-urlencoded (handled
// inside linkedinAdsClient.exchangeCodeForToken) and there is no
// long-lived-token exchange step — the token returned here already carries
// its real (~60 day) expiry.
const callback = async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return popupResponsePage(res, { type: 'li-oauth-error', message: errorDescription || error });
  }

  let decoded;
  try {
    decoded = jwt.verify(state, process.env.JWT_SECRET);
  } catch (err) {
    return popupResponsePage(res, { type: 'li-oauth-error', message: 'Invalid or expired OAuth state.' });
  }

  if (decoded.purpose !== 'li-oauth') {
    return popupResponsePage(res, { type: 'li-oauth-error', message: 'Invalid OAuth state.' });
  }

  try {
    const Admin = mongoose.model('Admin');
    const LinkedInConnection = mongoose.model('LinkedInConnection');

    const admin = await Admin.findOne({ _id: decoded.adminId, removed: false }).exec();
    if (!admin) throw new Error('Connecting admin not found.');

    const token = await client.exchangeCodeForToken({
      code,
      redirectUri: process.env.LINKEDIN_REDIRECT_URI,
    });
    const me = await client.getUserInfo(token.access_token);

    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined;

    let conn = await findConnection();
    if (!conn) conn = new LinkedInConnection({});

    conn.linkedinUserId = me.sub;
    conn.linkedinUserName = me.name;
    conn.accessToken = tokenCrypto.encrypt(token.access_token);
    conn.tokenExpiresAt = expiresAt;
    conn.status = 'connected';
    conn.connectedBy = admin.name;
    conn.lastError = undefined;
    conn.updated = Date.now();
    await conn.save();

    return popupResponsePage(res, { type: 'li-oauth-success' });
  } catch (err) {
    return popupResponsePage(res, { type: 'li-oauth-error', message: err.message });
  }
};

module.exports = callback;
