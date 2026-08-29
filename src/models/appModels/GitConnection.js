const mongoose = require('mongoose');

// Unlike GoogleConnection/FacebookConnection (one org-wide connection), each
// admin connects their own GitHub account here — Git Management shows every
// employee their own repos with their own GitHub permissions, so the token
// is keyed per-admin rather than being a single shared connection. Tokens
// are stored encrypted (see utils/githubTokenCrypto.js) and must never be
// sent to the frontend as-is — controllers strip them before responding.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },

  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    unique: true,
  },

  githubUserId: String,
  githubUsername: String,
  githubAvatarUrl: String,
  scope: String, // comma-separated scopes GitHub actually granted

  refreshToken: String, // encrypted at rest — only set if GitHub issued one (expiring-token apps)
  accessToken: String, // encrypted at rest
  tokenExpiresAt: Date, // only set if GitHub issued an expiring token

  status: {
    type: String,
    enum: ['connected', 'disconnected', 'error'],
    default: 'connected',
  },
  lastError: String,

  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('GitConnection', schema);
