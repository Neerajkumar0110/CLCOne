const mongoose = require('mongoose');

// CRM entity  ⇄  Moodle object, for everything that isn't a user or an
// enrolment: courses, categories, cohorts (batches), bbb activity instances.
// `kind` + `crmId` is unique; `idnumber` written on the Moodle side is the
// CRM _id string so the sync is self-healing.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  kind: { type: String, enum: ['course', 'category', 'cohort', 'bbb'], required: true },
  crmModel: { type: String }, // 'Course' | 'Batch' | ...
  crmId: { type: mongoose.Schema.ObjectId, required: true },
  crmIdString: { type: String, required: true },

  moodleId: { type: Number, index: true }, // course id / category id / cohort id / cmid
  shortname: { type: String }, // course shortname / cohort idnumber
  extra: { type: mongoose.Schema.Types.Mixed }, // e.g. { contextid, categoryPath }

  syncStatus: { type: String, enum: ['pending', 'synced', 'failed'], default: 'pending' },
  lastSyncedAt: { type: Date },
  lastError: { type: String },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ kind: 1, crmId: 1 }, { unique: true });
schema.index({ kind: 1, moodleId: 1 });

module.exports = mongoose.model('MoodleObjectMap', schema);
