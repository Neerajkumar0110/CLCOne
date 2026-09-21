const mongoose = require('mongoose');

// Mirrors a Google Ads Responsive Search Ad (adGroupAd). Google has no
// separate "Ad Creative" object the way Meta does — headlines/descriptions
// live directly on the ad, so unlike FacebookAd.js there's no creativeId
// ref here. Created PAUSED, only flips to ENABLED through the explicit
// "Publish" action.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  customerId: { type: String, required: true },
  campaignId: { type: mongoose.Schema.ObjectId, ref: 'GoogleCampaign', required: true },
  adGroupId: { type: mongoose.Schema.ObjectId, ref: 'GoogleAdGroup', required: true },

  googleAdResourceName: String, // e.g. "customers/123/adGroupAds/789~1"
  name: { type: String, required: true }, // internal-only label; Google's adGroupAd has no "name" field

  headlines: { type: [String], default: [] }, // Google requires >= 3
  descriptions: { type: [String], default: [] }, // Google requires >= 2
  finalUrls: { type: [String], default: [] },

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

module.exports = mongoose.model('GoogleAd', schema);
