const mongoose = require('mongoose');
const tokenCrypto = require('@/utils/vercelTokenCrypto');

// Every admin connects their own Vercel account — lookups are always scoped
// to the requesting admin's id, mirroring gitConnectionController/_helpers.js.
async function findConnection(adminId) {
  const VercelConnection = mongoose.model('VercelConnection');
  return VercelConnection.findOne({ admin: adminId, removed: false }).exec();
}

// Strips the token before anything goes to the frontend.
function sanitizeConnection(conn) {
  if (!conn) return { connected: false, status: 'disconnected' };
  return {
    connected: conn.status === 'connected',
    status: conn.status,
    vercelUsername: conn.vercelUsername,
    vercelEmail: conn.vercelEmail,
    vercelAvatarUrl: conn.vercelAvatarUrl,
    teamId: conn.teamId,
    lastError: conn.lastError,
    updated: conn.updated,
  };
}

function decryptedAccessToken(conn) {
  if (!conn || !conn.accessToken) return null;
  return tokenCrypto.decrypt(conn.accessToken);
}

// Every project/deployment/env-var handler needs an active connection before
// it can call the Vercel API — this is the one place that check lives, so
// every handler gets the same real error instead of a generic 500.
async function requireConnection(req, res) {
  const conn = await findConnection(req.admin._id);
  if (!conn || conn.status !== 'connected') {
    res.status(400).json({ success: false, result: null, message: 'Vercel is not connected yet.' });
    return null;
  }
  return conn;
}

module.exports = {
  findConnection,
  sanitizeConnection,
  decryptedAccessToken,
  requireConnection,
};
