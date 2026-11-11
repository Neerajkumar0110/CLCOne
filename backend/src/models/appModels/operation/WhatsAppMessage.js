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
    status: { type: String, enum: ['sending', 'sent', 'failed', 'received'], default: 'sending' },
    providerMessageId: { type: String, index: true },
    error: { type: String },
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WhatsAppMessage', schema);
