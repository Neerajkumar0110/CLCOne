const mongoose = require('mongoose');

// One conversation = one CRM user's WhatsApp number ↔ one customer number.
// Denormalised user name + department so the admin Live Chats screen can
// list and group chats without a cross-database join (Admin lives in coreDb).
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.ObjectId, required: true, index: true },
    userName: { type: String },
    department: { type: String, index: true },
    deviceId: { type: String, index: true },
    customerNumber: { type: String, required: true },
    customerName: { type: String },
    lastMessage: { type: String },
    lastMessageAt: { type: Date, index: true },
    lastDirection: { type: String, enum: ['incoming', 'outgoing'] },
    unread: { type: Number, default: 0 },
  },
  { timestamps: true }
);

schema.index({ userId: 1, customerNumber: 1 }, { unique: true });

module.exports = mongoose.model('WhatsAppChat', schema);
