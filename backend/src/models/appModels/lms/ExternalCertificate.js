const mongoose = require('mongoose');

// A certificate from another provider (IBM, Microsoft, Google…) a learner
// adds to their LMS profile — design L8 "IBM · … UNVERIFIED · learner-provided
// upload · provider verification link pending check by Support". Kept apart
// from Career Lab's own Certificate records; Support verifies or rejects it.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  student: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  studentName: String,
  studentEmail: String,

  provider: { type: String, required: true }, // e.g. IBM
  title: { type: String, required: true }, // e.g. Generative AI for Business and Professionals
  credentialId: String,
  verifyUrl: String, // the provider's own verification link
  issuedOn: Date,
  file: { name: String, url: String }, // optional upload (public/uploads/external-certificates/<adminId>-…)

  status: { type: String, enum: ['unverified', 'verified', 'rejected'], default: 'unverified', index: true },
  reviewedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  reviewedByName: String,
  reviewedAt: Date,
  reviewNote: String,

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ExternalCertificate', schema);
