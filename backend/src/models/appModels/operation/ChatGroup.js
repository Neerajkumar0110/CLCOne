const mongoose = require('mongoose');

// Team Chat groups (LMS testing report #40 / WhatsApp ask 2c): a Teacher,
// Support or admin makes a group — e.g. a whole batch + its teacher +
// Support — and everyone in it talks in one thread. Messages are ordinary
// Message rows with `group` set (messageController/groups.js).
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  name: { type: String, required: true, trim: true },
  batch: { type: String },
  members: { type: [{ type: mongoose.Schema.ObjectId, ref: 'Admin' }], default: [], index: true },
  // when each member last opened the group — unread counts
  reads: { type: [{ _id: false, user: { type: mongoose.Schema.ObjectId, ref: 'Admin' }, at: Date }], default: [] },
  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  createdByName: String,
  lastMessageAt: Date,
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ChatGroup', schema);
