const mongoose = require('mongoose');

// The Google account the LMS reads class recordings from (Recordings →
// "Import from Drive"). One active row at a time — connecting again (same or
// another account) replaces it. Uses the same Google OAuth client as the
// Google Ads integration, with the read-only Drive scope only. Tokens are
// encrypted at rest (utils/googleTokenCrypto.js) and never sent to the
// frontend.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  googleUserId: String,
  googleUserEmail: String,

  refreshToken: String, // encrypted
  accessToken: String, // encrypted, ~1 hour
  tokenExpiresAt: Date,

  connectedBy: String,
  lastError: String,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsDriveConnection', schema);
