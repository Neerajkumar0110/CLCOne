const mongoose = require('mongoose');
const { emitRead } = require('@/socket');

// PATCH /api/message/read-all — "Mark all as read" in the notification
// bell: marks every unread message addressed to the caller as read, across
// every conversation in one shot, and tells each affected sender live so
// their open threads' ticks flip too (see emitRead in backend/src/socket.js).
const markAllRead = async (req, res) => {
  const Message = mongoose.model('Message');

  const unread = await Message.find({ removed: false, to: req.admin._id, readAt: null })
    .select('conversationId from')
    .lean();

  if (unread.length === 0) {
    return res.status(200).json({ success: true, result: { updated: 0 }, message: 'Nothing to mark read' });
  }

  const readAt = new Date();
  await Message.updateMany({ removed: false, to: req.admin._id, readAt: null }, { $set: { readAt } });

  const notified = new Set();
  unread.forEach((m) => {
    const key = `${m.conversationId}:${m.from}`;
    if (notified.has(key)) return;
    notified.add(key);
    emitRead({ conversationId: m.conversationId, senderId: m.from, readerId: req.admin._id, readAt });
  });

  return res.status(200).json({
    success: true,
    result: { updated: unread.length },
    message: 'Marked all as read',
  });
};

module.exports = markAllRead;
