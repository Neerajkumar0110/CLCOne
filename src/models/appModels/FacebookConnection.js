const mongoose = require('mongoose');

// Org-wide Meta/Facebook connection (this app has no multi-tenancy anywhere
// else, so there's one connection record, not one per admin). Tokens are
// stored encrypted (see utils/metaTokenCrypto.js) and must never be sent to
// the frontend as-is — controllers strip them before responding.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  metaUserId: String,
  metaUserName: String,

  pageId: String,
  pageName: String,
  pageAccessToken: String, // encrypted at rest

  userAccessToken: String, // encrypted at rest — long-lived user token
  tokenExpiresAt: Date,

  adAccountId: String,
  adAccountName: String,

  webhookSubscribed: {
    type: Boolean,
    default: false,
  },

  status: {
    type: String,
    enum: ['pending', 'connected', 'disconnected', 'error'],
    default: 'pending',
  },
  lastError: String,
  connectedBy: String,

  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('FacebookConnection', schema);
