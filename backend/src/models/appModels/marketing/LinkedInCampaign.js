const mongoose = require('mongoose');

// Mirrors a LinkedIn Marketing API Campaign — the middle tier of LinkedIn's
// hierarchy, carrying targeting/budget/objective. Roughly the same role a
// FacebookAdSet plays for Meta, linked to a LinkedInCampaignGroup by
// internal _id (campaignGroupId), the same way FacebookAdSet links to
// FacebookCampaign.
const targetingSchema = new mongoose.Schema(
  {
    locations: { type: [String], default: [] }, // LinkedIn geo URNs, e.g. urn:li:geo:103644278
    industries: { type: [String], default: [] }, // LinkedIn industry URNs
    seniorities: { type: [String], default: [] },
  },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  campaignGroupId: { type: mongoose.Schema.ObjectId, ref: 'LinkedInCampaignGroup', required: true },
  adAccountId: { type: String, required: true },
  linkedinCampaignId: String, // numeric id inside urn:li:sponsoredCampaign:...

  name: { type: String, required: true },
  objectiveType: { type: String, default: 'LEAD_GENERATION' },
  costType: { type: String, default: 'CPM' },

  dailyBudget: Number, // major currency units
  totalBudget: Number,
  unitCost: Number,

  targeting: targetingSchema,

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

module.exports = mongoose.model('LinkedInCampaign', schema);
