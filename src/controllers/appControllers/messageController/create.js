const mongoose = require('mongoose');
const conversationIdFor = require('./conversationIdFor');
const buildReplySnapshot = require('./buildReplySnapshot');
const { emitMessage } = require('../../../socket');

// POST /api/message/create — text-only message. Use /message/upload instead
// for one with an attachment. Optional body.replyTo is the _id of the
// message being replied to (WhatsApp-style quote).
const create = async (req, res) => {
  const Message = mongoose.model('Message');
  const Admin = mongoose.model('Admin');

  const { to, text, replyTo } = req.body;

  if (!to) {
    return res.status(400).json({ success: false, result: null, message: 'to is required' });
  }
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, result: null, message: 'text is required' });
  }
  if (String(to) === String(req.admin._id)) {
    return res.status(400).json({ success: false, result: null, message: "Can't message yourself" });
  }

  const recipient = await Admin.findOne({ _id: to, removed: false }).select('_id').lean();
  if (!recipient) {
    return res.status(404).json({ success: false, result: null, message: 'Recipient not found' });
  }

  const conversationId = conversationIdFor(req.admin._id, to);

  const message = await new Message({
    conversationId,
    from: req.admin._id,
    to,
    text: text.trim(),
    replyTo: await buildReplySnapshot(replyTo, conversationId),
  }).save();

  emitMessage(message);

  return res.status(200).json({ success: true, result: message, message: 'Message sent' });
};

module.exports = create;
