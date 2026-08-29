const mongoose = require('mongoose');

// Org-wide Google Ads connection (this app has no multi-tenancy anywhere
// else — mirrors FacebookConnection.js). Tokens are stored encrypted (see
// utils/googleTokenCrypto.js) and must never be sent to the frontend as-is —
// controllers strip them before responding.
//
// webhookKey has no Meta equivalent: Google's Lead Form webhook isn't
// subscribed via an API call the way Meta's /subscribed_apps is — the
// advertiser pastes this app's webhook URL + this generated key directly
// into the Lead form asset inside the Google Ads UI ("Connect to a CRM
// using webhook integration"). Every inbound webhook POST is authenticated
// by checking it carries this same key back (see googleController/webhook.js).
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  googleUserId: String,
  googleUserEmail: String,

  customerId: String, // Google Ads account ("customer") id, digits only, no dashes
  customerName: String,
  loginCustomerId: String, // set when customerId is a client account under a manager account

  refreshToken: String, // encrypted at rest — Google refresh tokens don't expire on their own
  accessToken: String, // encrypted at rest — short-lived (~1hr), refreshed on demand via refreshToken
  tokenExpiresAt: Date,

  webhookKey: String, // random key the advertiser pastes into the Lead form asset's webhook config

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

module.exports = mongoose.model('GoogleConnection', schema);
