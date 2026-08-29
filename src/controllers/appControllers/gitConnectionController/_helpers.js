const mongoose = require('mongoose');
const tokenCrypto = require('@/utils/githubTokenCrypto');
const github = require('@/utils/githubClient');

// Unlike Google Ads/Facebook (one org-wide connection), every admin connects
// their own GitHub account, so lookups are always scoped to the requesting
// admin's id — see models/appModels/GitConnection.js.
async function findConnection(adminId) {
  const GitConnection = mongoose.model('GitConnection');
  return GitConnection.findOne({ admin: adminId, removed: false }).exec();
}

// Strips tokens before anything goes to the frontend.
function sanitizeConnection(conn) {
  if (!conn) return { connected: false, status: 'disconnected' };
  return {
    connected: conn.status === 'connected',
    status: conn.status,
    githubUsername: conn.githubUsername,
    githubAvatarUrl: conn.githubAvatarUrl,
    scope: conn.scope,
    lastError: conn.lastError,
    updated: conn.updated,
  };
}

function decryptedRefreshToken(conn) {
  if (!conn || !conn.refreshToken) return null;
  return tokenCrypto.decrypt(conn.refreshToken);
}

// Classic GitHub OAuth Apps issue non-expiring tokens by default (no
// tokenExpiresAt ever gets set — see callback.js), so most connections never
// need a refresh here. Orgs that enable "expire user authorization tokens"
// get a refresh_token + expires_in back instead, which this honors the same
// way googleController/_helpers.js refreshes Google Ads tokens.
async function getFreshAccessToken(conn) {
  if (!conn.tokenExpiresAt) {
    if (!conn.accessToken) throw new Error('GitHub is not connected (no access token stored).');
    return tokenCrypto.decrypt(conn.accessToken);
  }

  if (conn.tokenExpiresAt.getTime() - Date.now() > 60 * 1000) {
    return tokenCrypto.decrypt(conn.accessToken);
  }

  const refreshToken = decryptedRefreshToken(conn);
  if (!refreshToken) throw new Error('GitHub access token expired and no refresh token is stored — reconnect GitHub.');

  const refreshed = await github.refreshAccessToken({ refreshToken });
  conn.accessToken = tokenCrypto.encrypt(refreshed.access_token);
  if (refreshed.refresh_token) conn.refreshToken = tokenCrypto.encrypt(refreshed.refresh_token);
  conn.tokenExpiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : undefined;
  await conn.save();
  return refreshed.access_token;
}

// Every repo/branch/commit/etc. handler needs an active connection before it
// can call the GitHub API — this is the one place that check lives, so every
// handler gets the same real error instead of a generic 500.
async function requireConnection(req, res) {
  const conn = await findConnection(req.admin._id);
  if (!conn || conn.status !== 'connected') {
    res.status(400).json({ success: false, result: null, message: 'GitHub is not connected yet.' });
    return null;
  }
  return conn;
}

module.exports = {
  findConnection,
  sanitizeConnection,
  decryptedRefreshToken,
  getFreshAccessToken,
  requireConnection,
};
