const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto = require('crypto');
const graph = require('@/utils/googleAdsClient');
const tokenCrypto = require('@/utils/googleTokenCrypto');
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

// GET /public/google/callback?code&state — Google redirects the OAuth popup
// here directly (no bearer token attached, it's a browser navigation), so
// this route lives under /public and trusts the signed `state` instead.
const callback = async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return popupResponsePage(res, { type: 'google-oauth-error', message: errorDescription || error });
  }

  let decoded;
  try {
    decoded = jwt.verify(state, process.env.JWT_SECRET);
  } catch (err) {
    return popupResponsePage(res, { type: 'google-oauth-error', message: 'Invalid or expired OAuth state.' });
  }

  if (decoded.purpose !== 'google-oauth') {
    return popupResponsePage(res, { type: 'google-oauth-error', message: 'Invalid OAuth state.' });
  }

  try {
    const Admin = mongoose.model('Admin');
    const GoogleConnection = mongoose.model('GoogleConnection');

    const admin = await Admin.findOne({ _id: decoded.adminId, removed: false }).exec();
    if (!admin) throw new Error('Connecting admin not found.');

    const tokens = await graph.exchangeCodeForToken({
      code,
      redirectUri: process.env.GOOGLE_ADS_REDIRECT_URI,
    });

    // access_type=offline + prompt=consent (see googleAdsClient.buildOAuthDialogUrl)
    // should always return one, but Google occasionally omits it on edge
    // cases — fail loudly rather than silently storing a connection that
    // can never refresh its access token.
    if (!tokens.refresh_token) {
      throw new Error(
        "Google did not return a refresh token — revoke this app's access at https://myaccount.google.com/permissions and try connecting again."
      );
    }

    const me = await graph.getUserInfo(tokens.access_token);

    let conn = await findConnection();
    if (!conn) conn = new GoogleConnection({});

    conn.googleUserId = me.sub || me.id;
    conn.googleUserEmail = me.email;
    conn.refreshToken = tokenCrypto.encrypt(tokens.refresh_token);
    conn.accessToken = tokenCrypto.encrypt(tokens.access_token);
    conn.tokenExpiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined;
    // Generated once and kept across reconnects — the advertiser pastes this
    // into the Google Ads UI, so rotating it on every OAuth round-trip would
    // silently break a webhook they already configured.
    if (!conn.webhookKey) conn.webhookKey = crypto.randomBytes(24).toString('hex');
    conn.status = 'connected';
    conn.connectedBy = admin.name;
    conn.lastError = undefined;
    conn.updated = Date.now();
    await conn.save();

    return popupResponsePage(res, { type: 'google-oauth-success' });
  } catch (err) {
    return popupResponsePage(res, { type: 'google-oauth-error', message: err.message });
  }
};

module.exports = callback;
