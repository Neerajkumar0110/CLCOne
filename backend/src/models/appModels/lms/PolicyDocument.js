const mongoose = require('mongoose');
const { CATEGORIES } = require('../../../config/lmsPolicyCategories');

// One row PER VERSION of a policy — publishing a new version of an existing
// policy (same `slug`) creates a new document rather than mutating the old
// one, so PolicyAcknowledgement rows always point at the exact version a
// learner signed (spec §12: "the exact version acknowledged").
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  slug: { type: String, required: true, index: true }, // stable id across versions, e.g. "attendance-policy"
  title: { type: String, required: true },
  category: { type: String, enum: CATEGORIES, default: 'Other' },
  version: { type: Number, required: true, default: 1 },

  content: { type: String, default: '' }, // rich/plain text body
  fileUrl: { type: String, default: '' }, // optional uploaded PDF/doc

  mandatory: { type: Boolean, default: true },
  audience: { type: String, enum: ['all', 'course', 'batch'], default: 'all' },
  course: { type: mongoose.Schema.ObjectId, ref: 'Course' },
  courseTitle: String,
  batch: { type: String },

  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  effectiveDate: { type: Date },

  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  createdByName: String,
  publishedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  publishedAt: Date,
  archivedAt: Date,

  // Denormalized counters, updated on publish + on each acknowledge — avoids
  // an aggregation query every time the admin list renders.
  recipientsCount: { type: Number, default: 0 },
  acknowledgedCount: { type: Number, default: 0 },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ slug: 1, version: -1 });

module.exports = mongoose.model('PolicyDocument', schema);
