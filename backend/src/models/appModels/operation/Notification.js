const mongoose = require('mongoose');

// A generic, app-wide event notification — distinct from Message (private
// 1:1 chat). Created by backend/src/notify.js whenever something
// notification-worthy happens in Leads/Tickets/Invoices/Payments/User
// Management, and pushed live via the "notification:new" socket event.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },

  recipient: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },

  // Which permission module this belongs to (frontend/src/config/
  // permissionModules.js) — lets the UI pick an icon and, if ever needed,
  // filter by area.
  module: { type: String, required: true },
  // A short machine-readable event key, e.g. 'lead.created', 'ticket.status'.
  type: { type: String, required: true },

  title: { type: String, required: true },
  body: String,
  // Frontend route to send the user to when they click this notification.
  link: String,
  // Denormalized display name of whoever triggered the event.
  actorName: String,

  readAt: Date,

  created: {
    type: Date,
    default: Date.now,
  },
});

schema.index({ recipient: 1, created: -1 });

module.exports = mongoose.model('Notification', schema);
