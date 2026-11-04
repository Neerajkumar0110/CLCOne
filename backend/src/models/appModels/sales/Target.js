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
  // CLC-POL-001 section 7: verified prospects due this month, plus any part of
  // the carried backlog the Sales Manager waived, with why.
  targetProspects: Number,
  backlogWaived: Number,
  backlogWaivedReason: String,
  // Section 7: every change of the prospect target, with who and why.
  targetProspectsHistory: {
    type: [{ _id: false, from: Number, to: Number, reason: String, byName: String, at: { type: Date, default: Date.now } }],
    default: [],
  },

  setBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  setByName: String,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ admin: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('Target', schema);
