const mongoose = require('mongoose');

// Mirrors a Meta Marketing API Ad Set — targeting/budget/schedule live here,
// linked to a FacebookCampaign by internal _id (campaignId).
const targetingSchema = new mongoose.Schema(
  {
    countries: { type: [String], default: [] },
    ageMin: Number,
    ageMax: Number,
    genders: { type: [Number], default: [] }, // Meta: 1=male, 2=female
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

  campaignId: { type: mongoose.Schema.ObjectId, ref: 'FacebookCampaign', required: true },
  adAccountId: { type: String, required: true },
  metaAdSetId: String,

  name: { type: String, required: true },
  dailyBudget: Number, // in the ad account's smallest currency unit (e.g. paise/cents)
  lifetimeBudget: Number,
  startTime: Date,
  endTime: Date,

  targeting: targetingSchema,
  placements: { type: [String], default: ['facebook', 'instagram'] },
  optimizationGoal: { type: String, default: 'LEAD_GENERATION' },
  billingEvent: { type: String, default: 'IMPRESSIONS' },

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

module.exports = mongoose.model('FacebookAdSet', schema);
