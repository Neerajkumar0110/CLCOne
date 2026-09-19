const mongoose = require('mongoose');

// Org-wide LinkedIn Ads connection (this app has no multi-tenancy anywhere
// else, so there's one connection record, not one per admin — mirrors
// FacebookConnection.js exactly). Tokens are stored encrypted (see
// utils/linkedinTokenCrypto.js) and must never be sent to the frontend
// as-is — controllers strip them before responding.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  linkedinUserId: String, // OpenID Connect "sub"
  linkedinUserName: String,

  // The Organization (LinkedIn Company Page) whose Lead Gen Forms this
  // integration reads — LinkedIn's parallel to a Facebook Page selection.
  organizationId: String,
  organizationName: String,

  accessToken: String, // encrypted at rest
  tokenExpiresAt: Date,

  adAccountId: String,
  adAccountName: String,

  // LinkedIn issues no refresh token on the standard flow — when
  // tokenExpiresAt passes, status flips to 'expired' and the admin has to
  // reconnect via OAuth again (see linkedinController/callback.js). There is
  // no silent-refresh code path anywhere in this integration.
  status: {
    type: String,
    enum: ['pending', 'connected', 'disconnected', 'expired', 'error'],
    default: 'pending',
  },
  lastError: String,
  connectedBy: String,

  // Watermark for linkedinLeadPoller.js — the last time a poll cycle
  // completed successfully across all forms, used as the lower bound for
  // the next cycle's leadFormResponses fetch.
  lastPolledAt: Date,

  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('LinkedInConnection', schema);
