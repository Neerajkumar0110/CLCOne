const mongoose = require('mongoose');

// Who may use WhatsApp in the CRM. ONE document (key: 'global'), edited only
// by CRM admins from Messenger › WhatsApp › Access.
//
//   departments: { Sales: { enabled: true, roles: ['Executive', …] }, … }
//   users:       [{ userId, mode: 'allow' | 'block' }]
//
// A user sees WhatsApp when their department is enabled AND their role is
// ticked, OR they have mode 'allow'. 'block' always wins. CRM admins always
// have it (they run the Access and Live Chats screens).
// See services/whatsapp/access.js for the rule itself.
const schema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    departments: { type: mongoose.Schema.Types.Mixed, default: {} },
    users: [
      {
        _id: false,
        userId: { type: mongoose.Schema.ObjectId, required: true },
        mode: { type: String, enum: ['allow', 'block'], required: true },
      },
    ],
    updatedBy: { type: mongoose.Schema.ObjectId },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model('WhatsAppAccess', schema);
