const mongoose = require('mongoose');

// How recently an admin must have pinged to still count as "online".
// Client pings every ~15s (see frontend socketContext), so 45s tolerates a
// couple of missed/slow beats before showing someone as offline.
const PRESENCE_WINDOW_MS = 45 * 1000;

// POST /api/presence/ping
// Combined heartbeat + fetch: records that the caller is active right now,
// then returns every admin currently considered online. Polled by the
// client in place of a websocket — the backend runs on Vercel serverless,
// where a persistent socket.io connection isn't possible.
const ping = async (req, res) => {
  const Admin = mongoose.model('Admin');
  const now = new Date();

  await Admin.updateOne({ _id: req.admin._id }, { $set: { lastSeenAt: now } });

  const cutoff = new Date(now.getTime() - PRESENCE_WINDOW_MS);
  const online = await Admin.find({ removed: false, lastSeenAt: { $gte: cutoff } })
    .select('_id')
    .lean();

  return res.status(200).json({
    success: true,
    result: { onlineIds: online.map((a) => String(a._id)) },
    message: 'ok',
  });
};

module.exports = { ping };
