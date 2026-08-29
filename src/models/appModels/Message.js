const mongoose = require('mongoose');

// One-to-one direct messages. `conversationId` is the two participants'
// Admin ids sorted and joined (see conversationIdFor.js in messageController)
// — a cheap deterministic key that avoids needing a separate Conversation
// collection just to look up "the thread between A and B".
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },

  conversationId: {
    type: String,
    required: true,
    index: true,
  },
  from: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  to: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  text: {
    type: String,
    trim: true,
  },
  attachment: {
    url: String,
    fileName: String,
    mimeType: String,
    fileType: {
      type: String,
      enum: ['image', 'video', 'file'],
    },
  },
  // Set once the recipient has opened the thread — see messageController/thread.js.
  readAt: Date,

  // Denormalized snapshot of the message being replied to (WhatsApp-style
  // quoted preview) — captured at send time so the quote still renders even
  // if the original is later removed. See messageController/create.js.
  replyTo: {
    messageId: { type: mongoose.Schema.ObjectId, ref: 'Message' },
    text: String,
    attachmentFileName: String,
    fromName: String,
  },

  created: {
    type: Date,
    default: Date.now,
  },
});

schema.index({ conversationId: 1, created: 1 });

module.exports = mongoose.model('Message', schema);
