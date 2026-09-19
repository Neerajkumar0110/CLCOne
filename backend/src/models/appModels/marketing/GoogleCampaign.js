const mongoose = require('mongoose');

// Mirrors a Google Ads Campaign. Created PAUSED and only flipped to ENABLED
// through the explicit "Publish" action — never on creation. Google requires
// a separate CampaignBudget resource to exist before a campaign can
// reference one; its resource name is kept here too since nothing else
// needs to reference it independently.
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
  googleCampaignResourceName: String, // e.g. "customers/123/campaigns/456" — needed for further mutate calls
  campaignBudgetResourceName: String,

  name: { type: String, required: true },
  advertisingChannelType: { type: String, default: 'SEARCH' },
  dailyBudgetMicros: Number, // 1,000,000 micros = 1 unit of the account's currency

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

module.exports = mongoose.model('GoogleCampaign', schema);
