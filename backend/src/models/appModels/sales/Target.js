const mongoose = require('mongoose');

// One row per (admin, calendar month) — a manager's monthly target for
// someone in their sales-hierarchy scope (see services/access/
// salesHierarchy.js). "Achieved" is never stored here — it's always computed
// live from Call/Payment for that admin + period, the same way
// performanceController/summary.js already does, so it can never drift out
// of sync with the real numbers.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  admin: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  adminName: String, // denormalized — Call.calledBy/Payment.createdBy are name-keyed, not ObjectId-keyed

  period: { type: String, required: true }, // "YYYY-MM", calendar month this target is for

  targetCalls: Number,
  targetDeals: Number,
  targetRevenue: Number,

  setBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  setByName: String,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ admin: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('Target', schema);
