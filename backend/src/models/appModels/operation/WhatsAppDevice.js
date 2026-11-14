const mongoose = require('mongoose');

// One linked WhatsApp number per CRM user. `deviceId` is DeroPo's device id
// (POST /api/device/create) — every QR / status / send call names it.
//
// kind 'business' (2026-11-14): a company number added by an admin on the
// WhatsApp admin page, not tied to a person. Its `userId` is a fresh ObjectId
// that only identifies that number's shared inbox (its chats carry the same
// userId); every WhatsApp admin can read and reply on it.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.ObjectId, required: true, unique: true },
    kind: { type: String, enum: ['personal', 'business'], default: 'personal', index: true },
    label: { type: String }, // business numbers: "Sales WhatsApp", "Support" …
    createdBy: { type: mongoose.Schema.ObjectId },
    userName: { type: String },
    deviceId: { type: String, required: true, index: true },
    name: { type: String },
    phoneNumber: { type: String },
    status: {
      type: String,
      enum: ['connecting', 'connected', 'disconnected'],
      default: 'connecting',
    },
    connectedAt: { type: Date },
    lastCheckedAt: { type: Date },
    lastError: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WhatsAppDevice', schema);
