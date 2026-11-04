const mongoose = require('mongoose');

// What a Sales user did inside the CRM between login and logout: every screen
// opened, button clicked, search typed and idle stretch. Sent in batches by
// frontend/src/hooks/useActivityTracker.js. Never holds what was typed into a
// form, only a search box's text. Rows delete themselves after 180 days.
const KINDS = ['screen', 'click', 'search', 'idle'];
const schema = new mongoose.Schema({
  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  adminName: String,
  kind: { type: String, enum: KINDS, required: true },
  at: { type: Date, required: true },
  path: String, // the CRM route it happened on
  label: String, // button text / search text
  seconds: Number, // idle: how long
});

schema.index({ admin: 1, at: -1 });
schema.index({ at: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

module.exports = mongoose.model('UserEvent', schema);
