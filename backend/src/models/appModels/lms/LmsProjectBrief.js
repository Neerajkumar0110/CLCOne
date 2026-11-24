const mongoose = require('mongoose');

// Project definition (Figma 2A "Create project"). Allocations (2B) copy what
// they need into LmsProjectAllocation, so editing a brief later never moves
// a running learner's deadline.
const fileSchema = new mongoose.Schema({ name: String, url: String, size: Number, kind: String }, { _id: false });

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  title: { type: String, required: true },
  description: String,
  difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'intermediate' },
  track: String, // course / track title
  skillLevel: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'intermediate' },
  stack: [String],
  deliverables: [String],
  rubric: [{ criterion: String, lookFor: String, max: Number, _id: false }], // max points; total = 100
  passScore: { type: Number, default: 60 },
  resubmissions: { allowed: { type: Number, default: 1 }, withinDays: { type: Number, default: 3 } },
  timerStart: { type: String, enum: ['allocation', 'startDate'], default: 'allocation' },
  startDate: Date,
  deadline: Date, // absolute deadline
  durationDays: Number, // or N days after the timer starts (used when no absolute deadline)
  reminders: { h48: { type: Boolean, default: true }, h24: { type: Boolean, default: true }, h1: { type: Boolean, default: true }, customH: Number },
  channels: { email: { type: Boolean, default: true }, inApp: { type: Boolean, default: true }, whatsapp: { type: Boolean, default: false } },
  resources: { type: [fileSchema], default: [] },
  rules: {
    lockAfterDeadline: { type: Boolean, default: true },
    autoDisqualify: { type: Boolean, default: true },
    allowExtension: { type: Boolean, default: true },
    allowGroups: { type: Boolean, default: false },
  },
  // 2B "Auto-allocation rule": new learners who match are allocated automatically
  autoRule: { on: { type: Boolean, default: false }, batch: String, track: String, minSkill: String },
  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  createdByName: String,
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

module.exports = mongoose.model('LmsProjectBrief', schema);
