const mongoose = require('mongoose');

// Raw copy of every call DeroPo makes to our webhook. DeroPo's incoming
// payload format is not documented to us yet, so keep exactly what arrived —
// if a reply doesn't show up in a chat, this tells us which field names to map.
const schema = new mongoose.Schema(
  {
    body: { type: mongoose.Schema.Types.Mixed },
    handled: { type: Boolean, default: false },
    note: { type: String },
  },
  { timestamps: true }
);

schema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // keep 30 days

module.exports = mongoose.model('WhatsAppWebhookLog', schema);
