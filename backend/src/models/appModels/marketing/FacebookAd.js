const mongoose = require('mongoose');

// Mirrors the final Meta Ad — Ad Account + Ad Set + Creative. Created PAUSED,
// only flips to ACTIVE through the explicit "Publish" action.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  adAccountId: { type: String, required: true },
  campaignId: { type: mongoose.Schema.ObjectId, ref: 'FacebookCampaign', required: true },
  adSetId: { type: mongoose.Schema.ObjectId, ref: 'FacebookAdSet', required: true },
  creativeId: { type: mongoose.Schema.ObjectId, ref: 'FacebookAdCreative', required: true },

  metaAdId: String,
  name: { type: String, required: true },

  status: {
    type: String,
    enum: ['PAUSED', 'ACTIVE', 'ARCHIVED'],
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

module.exports = mongoose.model('FacebookAd', schema);
