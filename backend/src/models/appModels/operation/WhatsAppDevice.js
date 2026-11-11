const mongoose = require('mongoose');

// One linked WhatsApp number per CRM user. `deviceId` is DeroPo's device id
// (POST /api/device/create) — every QR / status / send call names it.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.ObjectId, required: true, unique: true },
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
