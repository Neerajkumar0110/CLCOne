const mongoose = require('mongoose');

// One project given to one learner or one group (Figma 2B–2G): live deadline
// timer, submission, rubric review, extensions, overrides, re-allocation.
// Status flow (2G): allocated → in_progress → submitted → under_review →
// qualified | not_qualified (→ resubmit) | disqualified (no submission).
const fileSchema = new mongoose.Schema({ name: String, url: String, size: Number }, { _id: false });
const STATUSES = ['allocated', 'in_progress', 'submitted', 'under_review', 'qualified', 'not_qualified', 'disqualified'];

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  brief: { type: mongoose.Schema.ObjectId, ref: 'LmsProjectBrief', required: true, index: true },
  briefTitle: String,
  stack: String,
  difficulty: String,
  mode: { type: String, enum: ['individual', 'group', 'auto', 'bulk'], default: 'individual' },
  learner: { type: mongoose.Schema.ObjectId, ref: 'Admin', index: true }, // individual
  members: [{ type: mongoose.Schema.ObjectId, ref: 'Admin', index: true }], // group (learner = first member)
  memberNames: [String],
  groupName: String,
  learnerName: String,
  learnerEmail: String,
  batch: { type: String, index: true },
  mentor: { type: mongoose.Schema.ObjectId, ref: 'Admin', index: true },
  mentorName: String,
  allocatedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  allocatedByName: String,

  status: { type: String, enum: STATUSES, default: 'allocated', index: true },
  allocatedAt: { type: Date, default: Date.now },
  startAt: Date, // timer start (allocation or the brief's start date)
  deadline: { type: Date, index: true },
  originalDeadline: Date,
  startedAt: Date, // first opened by the learner
  submittedAt: Date,
  timeTakenMs: Number, // startAt → submittedAt
  lockedAt: Date,
  allowLate: { type: Boolean, default: false }, // brief rule "Lock submission after deadline" was off

  deliverablesDone: [Boolean],
  draft: { githubUrl: String, demoUrl: String, note: String, files: [fileSchema], savedAt: Date },
  submissions: [
    {
      version: Number,
      githubUrl: String,
      demoUrl: String,
      note: String,
      files: [fileSchema],
      at: Date,
      by: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
      byName: String,
      _id: false,
    },
  ],
  submission: { version: Number, githubUrl: String, demoUrl: String, files: [fileSchema], at: Date }, // latest

  remindersSent: { h48: Date, h24: Date, h1: Date, custom: Date },
  disqualifiedAt: Date,

  extension: {
    status: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    days: Number,
    reason: String,
    requestedAt: Date,
    requestedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
    decidedAt: Date,
    decidedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
    decidedByName: String,
    grantedDays: Number,
    nudges: [{ by: String, at: Date, _id: false }],
    notifiedAt: Date,
  },

  review: {
    scores: [{ criterion: String, score: Number, max: Number, _id: false }],
    score: Number,
    decision: { type: String, enum: ['qualified', 'not_qualified', null] },
    feedback: String,
    published: { type: Boolean, default: false },
    at: Date,
    by: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
    byName: String,
    version: Number,
  },
  resubmit: { allowed: Boolean, left: Number, deadline: Date },

  reallocation: {
    status: { type: String, enum: ['none', 'requested', 'done'], default: 'none' },
    requestedAt: Date,
    requestedByName: String,
    note: String,
    doneAt: Date,
    count: { type: Number, default: 0 },
  },

  timeline: [{ at: Date, text: String, tone: String, kind: String, _id: false }],
  audit: [{ at: Date, byName: String, from: String, to: String, reason: String, _id: false }],
  notices: [{ at: Date, kind: String, channel: String, ok: Boolean, note: String, _id: false }],

  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ status: 1, deadline: 1 });
schema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('LmsProjectAllocation', schema);
