const mongoose = require('mongoose');

// Manual monthly cost / revenue input per System, powering the dashboard's
// CAC / Lead-Cost / ROI / Revenue-Prediction ratios. One row per
// (month, businessType, region, systemType). Any dimension may be null =
// "applies to that whole slice".
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  month: { type: String, required: true, index: true }, // "YYYY-MM"
  businessType: { type: String, enum: ['B2B', 'B2C', null], default: null },
  region: { type: String, enum: ['India', 'USA', null], default: null },
  systemType: { type: String, enum: ['Human', 'AI', null], default: null },
  // Optional lead-source tag — lets a cost row be attributed to one channel
  // (e.g. "Facebook Ads") for the Marketing dashboard's per-source ROI.
  source: { type: String, default: null },

  marketingSpend: { type: Number, default: 0 },
  agentCost: { type: Number, default: 0 },
  otherCost: { type: Number, default: 0 },
  revenue: { type: Number, default: 0 }, // actual booked revenue for the slice
  avgDealValue: { type: Number, default: 0 }, // used for revenue prediction
  currency: { type: String, default: 'INR' },
  notes: String,

  updatedBy: String,
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index(
  { month: 1, businessType: 1, region: 1, systemType: 1, source: 1 },
  { unique: true }
);

module.exports = mongoose.model('SalesCost', schema);
