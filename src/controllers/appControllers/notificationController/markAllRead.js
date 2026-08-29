const mongoose = require('mongoose');

// PATCH /api/notification/read-all — marks every unread notification
// addressed to the caller as read, in one shot.
const markAllRead = async (req, res) => {
  const Notification = mongoose.model('Notification');

  const { modifiedCount } = await Notification.updateMany(
    { removed: false, recipient: req.admin._id, readAt: null },
    { $set: { readAt: new Date() } }
  );

  return res.status(200).json({
    success: true,
    result: { updated: modifiedCount },
    message: 'Marked all as read',
  });
};

module.exports = markAllRead;
