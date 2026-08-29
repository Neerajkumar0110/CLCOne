const mongoose = require('mongoose');
const tokenCrypto = require('@/utils/metaTokenCrypto');

// There's exactly one org-wide Facebook connection (see plan: this app has
// no multi-tenancy anywhere else). This finds it regardless of status so
// callers can decide what "no connection yet" vs "disconnected" means.
async function findConnection() {
  const FacebookConnection = mongoose.model('FacebookConnection');
  return FacebookConnection.findOne({ removed: false }).sort({ created: -1 }).exec();
}

// Strips tokens before anything goes to the frontend.
function sanitizeConnection(conn) {
  if (!conn) return { connected: false, status: 'disconnected' };
  return {
    connected: conn.status === 'connected',
    status: conn.status,
    metaUserName: conn.metaUserName,
    page: conn.pageId ? { id: conn.pageId, name: conn.pageName } : null,
    adAccount: conn.adAccountId ? { id: conn.adAccountId, name: conn.adAccountName } : null,
    webhookSubscribed: conn.webhookSubscribed,
    connectedBy: conn.connectedBy,
    lastError: conn.lastError,
    updated: conn.updated,
  };
}

function decryptedUserToken(conn) {
  if (!conn || !conn.userAccessToken) return null;
  return tokenCrypto.decrypt(conn.userAccessToken);
}

function decryptedPageToken(conn) {
  if (!conn || !conn.pageAccessToken) return null;
  return tokenCrypto.decrypt(conn.pageAccessToken);
}

// Every facebookController route needs an active, page-selected connection
// before it can call the Marketing API — this is the one place that check
// lives, so every handler gets the same real error instead of a generic 500.
async function requireConnection(res, { needPage = false, needAdAccount = false } = {}) {
  const conn = await findConnection();
  if (!conn || conn.status !== 'connected') {
    res.status(400).json({ success: false, result: null, message: 'Facebook is not connected yet.' });
    return null;
  }
  if (needPage && !conn.pageId) {
    res.status(400).json({ success: false, result: null, message: 'Select a Facebook Page first.' });
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
  decryptedUserToken,
  decryptedPageToken,
  requireConnection,
};
