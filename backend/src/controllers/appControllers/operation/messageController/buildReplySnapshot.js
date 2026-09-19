const mongoose = require('mongoose');

// Looks up the message being replied to and returns the denormalized
// snapshot stored on the new message (see Message.js's replyTo field).
// Returns null for no reply, or if replyToId doesn't resolve to a real
// message in this same conversation (silently dropped rather than erroring
// — a stale/foreign id just means "send without the quote").
async function buildReplySnapshot(replyToId, conversationId) {
  if (!replyToId) return null;

  const Message = mongoose.model('Message');
  const Admin = mongoose.model('Admin');

  const original = await Message.findOne({ _id: replyToId, removed: false, conversationId }).lean();
  if (!original) return null;

  const fromAdmin = await Admin.findOne({ _id: original.from }).select('name surname').lean();
  const fromName = fromAdmin ? (fromAdmin.surname ? `${fromAdmin.name} ${fromAdmin.surname}` : fromAdmin.name) : null;

  return {
    messageId: original._id,
    text: original.text || '',
    attachmentFileName: original.attachment?.fileName || null,
    fromName,
  };
}

module.exports = buildReplySnapshot;
