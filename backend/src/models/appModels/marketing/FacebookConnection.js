const mongoose = require('mongoose');

// Any number of Meta/Facebook accounts can be connected at once (one
// document each, matched by metaUserId so reconnecting the same account
// updates its own row instead of creating a duplicate) — `active` marks
// which one manual Campaign Setup / the campaign-creation routes currently
// act on (see facebookController/_helpers.js#findConnection). Auto-launch
// (services/marketing/autoLaunchCampaign.js) isn't limited to the active
// one — it fires for whichever specific connection just finished OAuth.
// Tokens are stored encrypted (see utils/metaTokenCrypto.js) and must never
// be sent to the frontend as-is — controllers strip them before responding.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },
  // Exactly one non-removed connection per platform should be active at a
  // time — connecting a new account activates it and deactivates the rest
  // (see callback.js), and the admin can switch back via "Set active" in
  // the Connected Accounts list.
  active: {
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
