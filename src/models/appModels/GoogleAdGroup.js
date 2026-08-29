const mongoose = require('mongoose');

// Mirrors a Google Ads Ad Group, linked to a GoogleCampaign by internal _id
// (campaignId) — same shape as FacebookAdSet.js linking to FacebookCampaign.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  campaignId: { type: mongoose.Schema.ObjectId, ref: 'GoogleCampaign', required: true },
  customerId: { type: String, required: true },
  googleAdGroupResourceName: String, // e.g. "customers/123/adGroups/789"

  name: { type: String, required: true },
  type: { type: String, default: 'SEARCH_STANDARD' },
  cpcBidMicros: Number, // 1,000,000 micros = 1 unit of the account's currency

  status: {
    type: String,
    enum: ['PAUSED', 'ENABLED', 'REMOVED'],
    default: 'PAUSED',
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

module.exports = mongoose.model('GoogleAdGroup', schema);
