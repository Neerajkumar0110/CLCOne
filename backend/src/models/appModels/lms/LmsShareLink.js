const mongoose = require('mongoose');

// Recruiter shareable profile link (Figma 1D + share modal). The learner
// decides what the public page shows, when it expires, and can revoke it.
// The same token verifies the PDF ("Verify at …/verify/<token>").
const schema = new mongoose.Schema({
  crmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  token: { type: String, required: true, unique: true },
  show: {
    scores: { type: Boolean, default: true }, // hire-readiness & score breakdown
    projects: { type: Boolean, default: true }, // projects with code & demo links
    resume: { type: Boolean, default: true }, // resume download
    mentor: { type: Boolean, default: false }, // mentor summary
    contact: { type: Boolean, default: false }, // email & phone
  },
  expiresAt: Date, // null = never
  viewers: { type: String, enum: ['anyone'], default: 'anyone' },
  revoked: { type: Boolean, default: false },
  views: { type: Number, default: 0 },
  lastViewedAt: Date,
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsShareLink', schema);
