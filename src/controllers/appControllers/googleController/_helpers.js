const mongoose = require('mongoose');
const tokenCrypto = require('@/utils/googleTokenCrypto');
const graph = require('@/utils/googleAdsClient');

// There's exactly one org-wide Google Ads connection (see plan: this app has
// no multi-tenancy anywhere else). This finds it regardless of status so
// callers can decide what "no connection yet" vs "disconnected" means.
async function findConnection() {
  const GoogleConnection = mongoose.model('GoogleConnection');
  return GoogleConnection.findOne({ removed: false }).sort({ created: -1 }).exec();
}

// The backend's own public base URL — reuses PUBLIC_SERVER_FILE (already
// used elsewhere in this app, see pdfController, to build absolute URLs to
// this server's own public assets) rather than introducing a second env var
// for the same concept. Falls back to APP_URL if unset.
function publicBaseUrl() {
  const base = process.env.PUBLIC_SERVER_FILE || process.env.APP_URL || '';
  return base.replace(/\/$/, '');
}

// Strips tokens before anything goes to the frontend. Unlike Facebook's
// sanitizeConnection, this also surfaces webhookUrl/webhookKey — Google's
// Lead Form webhook has no OAuth-triggered subscribe step, so the frontend
// needs to show the admin exactly what to paste into the Google Ads UI
// ("Connect to a CRM using webhook integration").
function sanitizeConnection(conn) {
  if (!conn) return { connected: false, status: 'disconnected' };
  return {
    connected: conn.status === 'connected',
    status: conn.status,
    googleUserEmail: conn.googleUserEmail,
    customer: conn.customerId ? { id: conn.customerId, name: conn.customerName } : null,
    loginCustomerId: conn.loginCustomerId,
    webhookUrl: `${publicBaseUrl()}/public/google/webhook`,
    webhookKey: conn.webhookKey,
    connectedBy: conn.connectedBy,
    lastError: conn.lastError,
    updated: conn.updated,
  };
}

function decryptedRefreshToken(conn) {
  if (!conn || !conn.refreshToken) return null;
  return tokenCrypto.decrypt(conn.refreshToken);
}

// Google access tokens are short-lived (~1hr) but refresh tokens are
// effectively permanent — rather than trust a cached expiry to the second,
// refresh whenever the cached token is within 60s of expiring (or missing).
// Every googleController route that needs to call the Ads API should get its
// access token through this, never straight off the connection document.
async function getFreshAccessToken(conn) {
  const refreshToken = decryptedRefreshToken(conn);
  if (!refreshToken) throw new Error('Google Ads is not connected (no refresh token stored).');

  if (conn.accessToken && conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - Date.now() > 60 * 1000) {
    return tokenCrypto.decrypt(conn.accessToken);
  }

  const refreshed = await graph.refreshAccessToken({ refreshToken });
  conn.accessToken = tokenCrypto.encrypt(refreshed.access_token);
  conn.tokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  await conn.save();
  return refreshed.access_token;
}

// Every googleController route needs an active, customer-selected connection
// before it can call the Ads API — this is the one place that check lives,
// so every handler gets the same real error instead of a generic 500.
async function requireConnection(res, { needCustomer = false } = {}) {
  const conn = await findConnection();
  if (!conn || conn.status !== 'connected') {
    res.status(400).json({ success: false, result: null, message: 'Google Ads is not connected yet.' });
    return null;
  }
  if (needCustomer && !conn.customerId) {
    res.status(400).json({ success: false, result: null, message: 'Select a Google Ads account first.' });
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
