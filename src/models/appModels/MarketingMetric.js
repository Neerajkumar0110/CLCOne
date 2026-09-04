const mongoose = require('mongoose');

// One row = the numbers a user typed for ONE marketing dashboard, for ONE
// month, for ONE slice (region / businessType / systemType). The derived
// "advance ratios" are computed at read time from METRIC_TEMPLATES formulas
// — only the raw inputs live here, in a free-form `values` map so a single
// model serves every manual dashboard (SEO, ORM, Email, WhatsApp, …).
const schema = new mongoose.Schema(
  {
    removed: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },

    dashboardKey: { type: String, required: true, index: true }, // LEAF_BY_KEY id
    template: { type: String, default: null }, // METRIC_TEMPLATES key (denormalised)
    month: { type: String, required: true }, // "YYYY-MM"

    region: { type: String, enum: ['India', 'USA', null], default: null },
    businessType: { type: String, enum: ['B2B', 'B2C', null], default: null },
    systemType: { type: String, enum: ['Human', 'AI', null], default: null },

    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    notes: { type: String, default: '' },

    updatedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin', default: null },
    updatedByName: { type: String, default: '' },

    created: { type: Date, default: Date.now },
    updated: { type: Date, default: Date.now },
  },
  { minimize: false }
);

// one row per dashboard + month + slice
schema.index(
  { dashboardKey: 1, month: 1, region: 1, businessType: 1, systemType: 1 },
  { unique: true }
);

module.exports = mongoose.model('MarketingMetric', schema);
