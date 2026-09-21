const mongoose = require('mongoose');

// The CRM-side record of "this person is in this course". The CRM decides
// enrolment (payment, batch membership, admin action); Moodle holds the
// runtime state. This row is the join the portals and analytics read, plus
// the projection of progress/completion pushed back by webhook.
const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  enabled: { type: Boolean, default: true },

  crmUser: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true },
  moodleUserId: { type: Number, index: true },

  crmCourse: { type: mongoose.Schema.ObjectId, ref: 'Course' },
  moodleCourseId: { type: Number, required: true, index: true },

  batch: { type: mongoose.Schema.ObjectId, ref: 'Batch' },
  roleShortname: { type: String, default: 'student' },

  source: {
    type: String,
    enum: ['self', 'admin', 'teacher', 'batch', 'payment', 'reconcile'],
    default: 'admin',
  },
  payment: { type: mongoose.Schema.ObjectId, ref: 'Payment' },

  status: { type: String, enum: ['pending', 'active', 'suspended', 'ended'], default: 'pending' },
  timestart: { type: Date },
  timeend: { type: Date }, // course expiry / access end
  moodleEnrolInstanceId: { type: Number },

  // projection, updated by the completion / grade webhooks
  progressPct: { type: Number, default: 0 },
  lastActivityAt: { type: Date },
  completedOn: { type: Date },
  finalGrade: { type: Number },

  syncStatus: { type: String, enum: ['pending', 'synced', 'failed'], default: 'pending' },
  lastSyncedAt: { type: Date },
  lastError: { type: String },

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ crmUser: 1, moodleCourseId: 1 }, { unique: true });
schema.index({ batch: 1 });
schema.index({ status: 1 });

module.exports = mongoose.model('LmsEnrolment', schema);
