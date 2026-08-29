const mongoose = require('mongoose');
const tokenCrypto = require('../../../utils/linkedinTokenCrypto');

// There's exactly one org-wide LinkedIn connection (see plan: this app has
// no multi-tenancy anywhere else). This finds it regardless of status so
// callers can decide what "no connection yet" vs "disconnected" means.
// Mirrors facebookController/_helpers.js's findConnection exactly.
async function findConnection() {
  const LinkedInConnection = mongoose.model('LinkedInConnection');
  return LinkedInConnection.findOne({ removed: false }).sort({ created: -1 }).exec();
}

// Strips tokens before anything goes to the frontend.
function sanitizeConnection(conn) {
  if (!conn) return { connected: false, status: 'disconnected' };
  return {
    connected: conn.status === 'connected',
    status: conn.status,
    linkedinUserName: conn.linkedinUserName,
    organization: conn.organizationId ? { id: conn.organizationId, name: conn.organizationName } : null,
    adAccount: conn.adAccountId ? { id: conn.adAccountId, name: conn.adAccountName } : null,
    tokenExpiresAt: conn.tokenExpiresAt,
    lastPolledAt: conn.lastPolledAt,
    connectedBy: conn.connectedBy,
    lastError: conn.lastError,
    updated: conn.updated,
  };
}

function decryptedAccessToken(conn) {
  if (!conn || !conn.accessToken) return null;
  return tokenCrypto.decrypt(conn.accessToken);
}

// LinkedIn issues no refresh token on the standard flow — a connection past
// its tokenExpiresAt can never be silently renewed, only reconnected via a
// fresh OAuth round trip (see connect.js/callback.js). Every route that
// needs a live token should treat an expired one the same as "not
// connected" rather than attempting (and failing) a real API call.
function isTokenExpired(conn) {
  return !!(conn && conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() <= Date.now());
}

// Every linkedinController route needs an active, non-expired connection
// (and usually an ad account / organization selection) before it can call
// the Marketing API — this is the one place that check lives, so every
// handler gets the same real error instead of a generic 500. Mirrors
// facebookController/_helpers.js's requireConnection.
async function requireConnection(res, { needOrganization = false, needAdAccount = false } = {}) {
  const conn = await findConnection();
  if (!conn || conn.status !== 'connected') {
    res.status(400).json({ success: false, result: null, message: 'LinkedIn is not connected yet.' });
    return null;
  }
  if (isTokenExpired(conn)) {
    conn.status = 'expired';
    conn.updated = Date.now();
    await conn.save();
    res.status(400).json({ success: false, result: null, message: 'LinkedIn access token has expired — reconnect via OAuth.' });
    return null;
  }
  if (needOrganization && !conn.organizationId) {
    res.status(400).json({ success: false, result: null, message: 'Select a LinkedIn Organization first.' });
    return null;
  }
  if (needAdAccount && !conn.adAccountId) {
    res.status(400).json({ success: false, result: null, message: 'Select an Ad Account first.' });
    return null;
  }
  return conn;
}

module.exports = {
  findConnection,
  sanitizeConnection,
  decryptedAccessToken,
  isTokenExpired,
  requireConnection,
};
