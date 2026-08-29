const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },

  subject: {
    type: String,
    required: true,
  },
  description: String,
  // One of PERMISSION_MODULES (frontend/src/config/permissionModules.js) —
  // the module the ticket is about.
  category: {
    type: String,
    required: true,
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High', 'Urgent'],
    default: 'Medium',
  },
  status: {
    type: String,
    enum: ['Open', 'In Progress', 'Resolved'],
    default: 'Open',
  },

  // Who raised it — set server-side from the authenticated admin, never
  // trusted from the request body (see ticketController/create.js).
  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  raisedByName: String,

  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Ticket', schema);
