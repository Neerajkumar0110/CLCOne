const mongoose = require('mongoose');
const tokenCrypto = require('../../../../utils/metaTokenCrypto');

// Multiple Facebook accounts can be connected at once (see
// FacebookConnection.js's header comment). "The" connection every campaign/
// ad-set/creative/ad route and manual Campaign Setup acts on is whichever
// one is marked `active` — falls back to the most recently connected
// non-removed one if none is marked active yet (covers rows saved before
// this field existed). Use findAllConnections()/findConnectionById() for
// anything that needs to see every connected account instead of just the
// active one (the Connected Accounts list, webhooks matching an inbound
// pageId, auto-launch targeting the specific account that just connected).
async function findConnection() {
  const FacebookConnection = mongoose.model('FacebookConnection');
  const active = await FacebookConnection.findOne({ removed: false, active: true }).sort({ created: -1 }).exec();
  if (active) return active;
  return FacebookConnection.findOne({ removed: false }).sort({ created: -1 }).exec();
}

async function findConnectionById(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  const FacebookConnection = mongoose.model('FacebookConnection');
  return FacebookConnection.findOne({ _id: id, removed: false }).exec();
}

async function findAllConnections() {
  const FacebookConnection = mongoose.model('FacebookConnection');
  return FacebookConnection.find({ removed: false }).sort({ created: -1 }).exec();
}

// Strips tokens before anything goes to the frontend.
function sanitizeConnection(conn) {
  if (!conn) return { connected: false, status: 'disconnected' };
  return {
    id: String(conn._id),
    active: !!conn.active,
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
  findConnectionById,
  findAllConnections,
  sanitizeConnection,
  decryptedUserToken,
  decryptedPageToken,
  requireConnection,
};
