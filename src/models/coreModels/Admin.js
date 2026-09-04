const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const { ROLES, FINANCE_SUB_ROLES } = require('../../config/roles');

const adminSchema = new Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: false,
  },

  email: {
    type: String,
    lowercase: true,
    trim: true,
    required: true,
  },
  name: { type: String, required: true },
  surname: { type: String },
  // Agent's own phone number. Used by CALLING_PROVIDER=cloud (Tata Smartflo
  // etc.) — the provider rings this number first, then bridges the customer.
  // Digits (E.164 or local); the provider adapter normalises it.
  phone: { type: String, trim: true },
  photo: {
    type: String,
    trim: true,
  },
  created: {
    type: Date,
    default: Date.now,
  },
  // Heartbeat timestamp for presence — refreshed by POST /api/presence/ping
  // every few seconds while the app is open in a tab. "Online" = this is
  // within the last PRESENCE_WINDOW_MS (see presenceController). Used instead
  // of a live socket because the backend runs on serverless (no persistent
  // connections).
  lastSeenAt: {
    type: Date,
  },
  role: {
    type: String,
    default: 'owner',
    enum: ROLES,
  },
  // Only meaningful when role === 'Finance' — picks which finance position
  // ("Finance Manager" / "Finance Executive" / "Finance Support") this user holds.
  subRole: {
    type: String,
    enum: FINANCE_SUB_ROLES,
  },
});

module.exports = mongoose.model('Admin', adminSchema);
