const mongoose = require('mongoose');

// Mirrors a Meta Marketing API Campaign. Created PAUSED and only flipped to
// ACTIVE through the explicit "Publish" action — never on creation.
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
  metaCampaignId: String,

  name: { type: String, required: true },
  objective: String, // e.g. OUTCOME_LEADS
  specialAdCategory: { type: String, default: 'NONE' },

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

module.exports = mongoose.model('FacebookCampaign', schema);
