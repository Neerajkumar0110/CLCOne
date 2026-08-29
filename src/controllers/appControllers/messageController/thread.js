const mongoose = require('mongoose');
const conversationIdFor = require('./conversationIdFor');
const { emitRead } = require('../../../socket');

// GET /api/message/thread/:userId?before=<ISO date>&limit=<n> — the
// conversation between the caller and :userId, newest-first internally but
// returned oldest-first (ready to render top-to-bottom). Opening a thread
// also marks every message sent to the caller in it as read, and — if that
// actually changed anything — tells the other party live (message:read) so
// their single ticks flip to double ticks without needing a refresh.
const thread = async (req, res) => {
  const Message = mongoose.model('Message');
  const Admin = mongoose.model('Admin');

  const { userId } = req.params;
  const other = await Admin.findOne({ _id: userId, removed: false })
    .select('name surname photo role')
    .lean();
  if (!other) {
    return res.status(404).json({ success: false, result: null, message: 'User not found' });
  }

  const conversationId = conversationIdFor(req.admin._id, userId);
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const beforeMatch = req.query.before ? { created: { $lt: new Date(req.query.before) } } : {};

  const messages = await Message.find({ removed: false, conversationId, ...beforeMatch })
    .sort({ created: -1 })
    .limit(limit)
    .lean();

  const readAt = new Date();
  const { modifiedCount } = await Message.updateMany(
    { removed: false, conversationId, to: req.admin._id, readAt: null },
    { $set: { readAt } }
  );

  if (modifiedCount > 0) {
    emitRead({ conversationId, senderId: userId, readerId: req.admin._id, readAt });
  }

  return res.status(200).json({
    success: true,
    result: { user: other, messages: messages.reverse() },
    message: 'Successfully found conversation',
  });
};

module.exports = thread;
