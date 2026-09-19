const mongoose = require('mongoose');

// PATCH /api/notification/:id/read — marks one of the caller's own
// notifications as read (called when they click it in the bell). Scoped to
// `recipient: req.admin._id` so nobody can mark someone else's as read.
const markRead = async (req, res) => {
  const Notification = mongoose.model('Notification');

  const result = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.admin._id, removed: false },
    { $set: { readAt: new Date() } },
    { new: true }
  );

  if (!result) {
    return res.status(404).json({ success: false, result: null, message: 'Notification not found' });
  }

  return res.status(200).json({ success: true, result, message: 'Marked as read' });
};

module.exports = markRead;
