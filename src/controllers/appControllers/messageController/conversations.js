const mongoose = require('mongoose');
const conversationIdFor = require('./conversationIdFor');
const { getOnlineUserIds } = require('../../../socket');

// GET /api/message/conversations — every other registered admin ("jitne
// register hai sab yaha par show ho"), each with their last message and
// unread count if a thread exists yet, so you can start a chat with anyone
// even before the first message is sent.
const conversations = async (req, res) => {
  const Admin = mongoose.model('Admin');
  const Message = mongoose.model('Message');

  const others = await Admin.find({ _id: { $ne: req.admin._id }, removed: false, enabled: true })
    .select('name surname photo role')
    .lean();

  const onlineIds = new Set(getOnlineUserIds());

  const results = await Promise.all(
    others.map(async (o) => {
      const conversationId = conversationIdFor(req.admin._id, o._id);
      const [lastMessage, unreadCount] = await Promise.all([
        Message.findOne({ removed: false, conversationId }).sort({ created: -1 }).lean(),
        Message.countDocuments({ removed: false, conversationId, to: req.admin._id, readAt: null }),
      ]);
      return {
        user: o,
        online: onlineIds.has(String(o._id)),
        lastMessage: lastMessage || null,
        unreadCount,
      };
    })
  );

  // Anyone with message history floats to the top, most-recent first;
  // everyone else (no history yet) follows alphabetically.
  results.sort((a, b) => {
    const at = a.lastMessage ? new Date(a.lastMessage.created).getTime() : 0;
    const bt = b.lastMessage ? new Date(b.lastMessage.created).getTime() : 0;
    if (at !== bt) return bt - at;
    return a.user.name.localeCompare(b.user.name);
  });

  return res.status(200).json({
    success: true,
    result: results,
    message: 'Successfully found conversations',
  });
};

module.exports = conversations;
