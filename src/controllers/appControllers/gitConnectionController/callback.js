const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const github = require('../../../utils/githubClient');
const tokenCrypto = require('../../../utils/githubTokenCrypto');
const { findConnection } = require('./_helpers');

// Renders a tiny self-closing page that hands the result back to the SPA
// window that opened this OAuth popup via postMessage, then closes itself.
// Mirrors googleController/callback.js.
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

// GET /public/git/callback?code&state — GitHub redirects the OAuth popup
// here directly (no bearer token attached, it's a browser navigation), so
// this route lives under /public and trusts the signed `state` instead.
const callback = async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return popupResponsePage(res, { type: 'github-oauth-error', message: errorDescription || error });
  }

  let decoded;
  try {
    decoded = jwt.verify(state, process.env.JWT_SECRET);
  } catch (err) {
    return popupResponsePage(res, { type: 'github-oauth-error', message: 'Invalid or expired OAuth state.' });
  }

  if (decoded.purpose !== 'github-oauth') {
    return popupResponsePage(res, { type: 'github-oauth-error', message: 'Invalid OAuth state.' });
  }

  try {
    const Admin = mongoose.model('Admin');
    const GitConnection = mongoose.model('GitConnection');

    const admin = await Admin.findOne({ _id: decoded.adminId, removed: false }).exec();
    if (!admin) throw new Error('Connecting admin not found.');

    const tokens = await github.exchangeCodeForToken({
      code,
      redirectUri: process.env.GITHUB_REDIRECT_URI,
    });

    const me = await github.getAuthenticatedUser(tokens.access_token);

    let conn = await findConnection(admin._id);
    if (!conn) conn = new GitConnection({ admin: admin._id });

    conn.githubUserId = String(me.id);
    conn.githubUsername = me.login;
    conn.githubAvatarUrl = me.avatar_url;
    conn.scope = tokens.scope;
    conn.accessToken = tokenCrypto.encrypt(tokens.access_token);
    conn.refreshToken = tokens.refresh_token ? tokenCrypto.encrypt(tokens.refresh_token) : undefined;
    conn.tokenExpiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined;
    conn.status = 'connected';
    conn.lastError = undefined;
    conn.updated = Date.now();
    await conn.save();

    return popupResponsePage(res, { type: 'github-oauth-success' });
  } catch (err) {
    return popupResponsePage(res, { type: 'github-oauth-error', message: err.message });
  }
};

module.exports = callback;
