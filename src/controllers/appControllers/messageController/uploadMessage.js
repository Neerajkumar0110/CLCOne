const mongoose = require('mongoose');
const conversationIdFor = require('./conversationIdFor');
const buildReplySnapshot = require('./buildReplySnapshot');
const { emitMessage } = require('@/socket');

function fileTypeFromMime(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

// POST /api/message/upload (multipart/form-data: to, text?, file, replyTo?)
// — a message carrying an image/video/any file, optionally with a caption
// and/or a WhatsApp-style quoted reply (see create.js).
const uploadMessage = async (req, res) => {
  const Message = mongoose.model('Message');
  const Admin = mongoose.model('Admin');

  const { to, text, replyTo } = req.body;

  if (!to) {
    return res.status(400).json({ success: false, result: null, message: 'to is required' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, result: null, message: 'file is required' });
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
    text: text ? text.trim() : '',
    attachment: {
      // singleStorageUpload's filename() callback already wrote this same
      // path into req.body.file (see middlewares/uploadMiddleware/singleStorageUpload.js).
      url: req.body.file,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      fileType: fileTypeFromMime(req.file.mimetype),
    },
    replyTo: await buildReplySnapshot(replyTo, conversationId),
  }).save();

  emitMessage(message);

  return res.status(200).json({ success: true, result: message, message: 'Message sent' });
};

module.exports = uploadMessage;
