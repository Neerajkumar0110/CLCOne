const mongoose = require('mongoose');

// GET /api/notification/mine?limit=<n> — the caller's own notifications,
// newest first. Read status lives per-recipient (each Notification doc
// belongs to exactly one recipient), so there's nothing to scope beyond
// req.admin._id.
const mine = async (req, res) => {
  const Notification = mongoose.model('Notification');

  const limit = Math.min(parseInt(req.query.limit) || 100, 300);
  const notifications = await Notification.find({ removed: false, recipient: req.admin._id })
    .sort({ created: -1 })
    .limit(limit)
    .lean();

  return res.status(200).json({
    success: true,
    result: notifications,
    message: 'Successfully found notifications',
  });
};

module.exports = mine;
