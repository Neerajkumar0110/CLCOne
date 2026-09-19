const { findConnection, sanitizeConnection } = require('./_helpers');

// GET /api/vercel/connection — real per-admin status, never a hard-coded boolean.
const getConnection = async (req, res) => {
  const conn = await findConnection(req.admin._id);
  return res.status(200).json({ success: true, result: sanitizeConnection(conn), message: 'OK' });
};

// DELETE /api/vercel/connection — wipes this admin's token and marks disconnected.
const disconnectConnection = async (req, res) => {
  const conn = await findConnection(req.admin._id);
  if (!conn) {
    return res.status(200).json({ success: true, result: sanitizeConnection(null), message: 'Already disconnected' });
  }

  conn.status = 'disconnected';
  conn.accessToken = undefined;
  conn.updated = Date.now();
  await conn.save();

  return res.status(200).json({ success: true, result: sanitizeConnection(conn), message: 'Vercel disconnected' });
};

module.exports = { getConnection, disconnectConnection };
