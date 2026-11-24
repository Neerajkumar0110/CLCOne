const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.ObjectId, required: true, index: true },
    userId: { type: mongoose.Schema.ObjectId, required: true, index: true },
    deviceId: { type: String },
    customerNumber: { type: String, required: true },
    direction: { type: String, enum: ['incoming', 'outgoing'], required: true },
    type: { type: String, default: 'text' },
    text: { type: String },
    // outgoing: sending → sent → delivered → read (DeroPo webhook events) | failed
    status: { type: String, enum: ['sending', 'sent', 'delivered', 'read', 'failed', 'received'], default: 'sending' },
    statusAt: { type: Date },
    providerMessageId: { type: String, index: true },
    error: { type: String },
    at: { type: Date, default: Date.now, index: true },
    // a photo / document / video / voice note (services/whatsapp/media.js):
    // url = our copy under /public/uploads/whatsapp/, thumb = WhatsApp's tiny preview
    media: {
      url: String,
      mime: String,
      fileName: String,
      size: Number,
      width: Number,
      height: Number,
      seconds: Number,
      pages: Number,
      voice: Boolean,
      thumb: String,
      pending: Boolean,
      error: String,
    },
    // WhatsApp's encrypted-file pointer, kept only until the file is downloaded
    mediaSrc: { type: { kind: String, url: String, directPath: String, mediaKey: String, mime: String, _id: false }, select: false },
    // the message this one replies to (quoted bubble)
    // 'teamchat' = a Team Chat message with this student, shown in the
    // thread but never sent to WhatsApp (services/whatsapp/teamChatBridge.js)
    via: { type: String },
    teamMessageId: { type: mongoose.Schema.ObjectId },
    quoted: {
      messageId: { type: mongoose.Schema.ObjectId },
      providerMessageId: String,
      text: String,
      fromCustomer: Boolean,
      // { type: String } — a bare `type: String` here would make Mongoose treat
      // the whole `quoted` object as a string and drop every reply
      type: { type: String },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WhatsAppMessage', schema);
