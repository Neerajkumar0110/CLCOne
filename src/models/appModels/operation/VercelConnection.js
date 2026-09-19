const mongoose = require('mongoose');

// Each admin connects their own Vercel account, like GitConnection — Vercel
// Management shows every employee their own projects/deployments scoped to
// whatever team/account they installed the integration on. Tokens are stored
// encrypted (see utils/vercelTokenCrypto.js) and must never be sent to the
// frontend as-is — controllers strip them before responding.
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

  vercelUserId: String,
  vercelUsername: String,
  vercelEmail: String,
  vercelAvatarUrl: String,

  teamId: String, // set only if the integration was installed on a Vercel team, not a personal account
  configurationId: String,

  accessToken: String, // encrypted at rest — Vercel integration tokens don't expire

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

module.exports = mongoose.model('VercelConnection', schema);
