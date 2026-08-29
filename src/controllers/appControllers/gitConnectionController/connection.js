const { findConnection, sanitizeConnection } = require('./_helpers');

// GET /api/git/connection — real per-admin status, never a hard-coded boolean.
const getConnection = async (req, res) => {
  const conn = await findConnection(req.admin._id);
  return res.status(200).json({ success: true, result: sanitizeConnection(conn), message: 'OK' });
};

// DELETE /api/git/connection — wipes this admin's tokens and marks disconnected.
const disconnectConnection = async (req, res) => {
  const conn = await findConnection(req.admin._id);
  if (!conn) {
    return res.status(200).json({ success: true, result: sanitizeConnection(null), message: 'Already disconnected' });
  }

  conn.status = 'disconnected';
  conn.refreshToken = undefined;
  conn.accessToken = undefined;
  conn.tokenExpiresAt = undefined;
  conn.updated = Date.now();
  await conn.save();

  return res.status(200).json({ success: true, result: sanitizeConnection(conn), message: 'GitHub disconnected' });
};

module.exports = { getConnection, disconnectConnection };
