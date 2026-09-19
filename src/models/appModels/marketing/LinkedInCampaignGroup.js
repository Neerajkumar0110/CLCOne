const mongoose = require('mongoose');

// Mirrors a LinkedIn Marketing API Campaign Group — the top tier of
// LinkedIn's 3-tier hierarchy (Campaign Group -> Campaign -> Creative),
// unlike Meta's Campaign -> Ad Set -> Creative -> Ad. Created PAUSED and
// only flipped to ACTIVE through the explicit "Publish" action — never on
// creation. Mirrors FacebookCampaign.js's role/shape.
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
  linkedinCampaignGroupId: String, // e.g. "123456789" (numeric id inside the urn:li:sponsoredCampaignGroup:... URN)

  name: { type: String, required: true },
  totalBudget: Number, // major currency units (e.g. USD), not minor units like Meta's smallest-currency-unit budgets

  status: {
    type: String,
    enum: ['DRAFT', 'PAUSED', 'ACTIVE', 'ARCHIVED', 'COMPLETED', 'CANCELED'],
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

module.exports = mongoose.model('LinkedInCampaignGroup', schema);
