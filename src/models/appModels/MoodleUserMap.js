const mongoose = require('mongoose');

// CRM user  ⇄  Moodle user. One row per person that exists on both sides.
// Dedupe rule: Moodle `idnumber` is always the CRM Admin _id as a string, so
// a re-run of the provision job can never create a second Moodle account.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  crmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, unique: true },
  crmUserIdString: { type: String, required: true }, // == String(crmUser); written to Moodle idnumber

  moodleUserId: { type: Number, index: true },
  username: { type: String },
  email: { type: String },

  lmsRole: { type: String, default: 'student' }, // roleMap.js LMS role
  portal: { type: String, enum: ['student', 'teacher', 'admin'], default: 'student' },
  siteAdmin: { type: Boolean, default: false },

  syncStatus: { type: String, enum: ['pending', 'synced', 'failed'], default: 'pending' },
  lastSyncedAt: { type: Date },
  lastError: { type: String },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ crmUserIdString: 1 });
schema.index({ email: 1 });

module.exports = mongoose.model('MoodleUserMap', schema);
