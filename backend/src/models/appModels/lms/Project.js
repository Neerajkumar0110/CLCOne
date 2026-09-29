const mongoose = require('mongoose');

// Individual learner project workspace (spec §10). One row per student per
// course-project. Visibility is enforced in the controller, not the schema:
// only the owning student, the assigned mentor and management roles may
// read/write a given row (spec: "prevent accidental exposure of one
// learner's project to another learner").
const milestoneSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    dueDate: Date,
    status: { type: String, enum: ['pending', 'in_progress', 'done'], default: 'pending' },
    completedAt: Date,
  },
  { _id: false }
);

const rubricItemSchema = new mongoose.Schema(
  { criterion: { type: String, required: true }, maxMarks: { type: Number, default: 10 } },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
    byName: String,
    at: Date,
    decision: { type: String, enum: ['approved', 'revision_requested', 'rejected'] },
    feedback: String,
    rubricScores: [{ criterion: String, marks: Number, _id: false }],
    totalScore: Number, // % of rubric max
  },
  { _id: false }
);

const submissionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    submittedAt: { type: Date, default: Date.now },
    note: String,
    githubUrl: String,
    deploymentUrl: String,
    files: [{ name: String, url: String, _id: false }],
    review: reviewSchema,
  },
  { _id: false }
);

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },

  // Self-generated, human-readable ID (e.g. "PRJ-AI101") — same
  // initials+counter pattern as Course.code/Batch.code/Assignment.code, with
  // a "PRJ-" prefix so it's never confused with those.
  code: { type: String },

  course: { type: mongoose.Schema.ObjectId, ref: 'Course', required: true, index: true },
  courseTitle: String,
  // The batch this project was assigned through — projects are now assigned
  // batch-wise (see lmsController/projects.js#assign), not by picking a
  // course directly, so this is what actually scopes "my batch's projects".
  batch: { type: String, index: true },

  student: { type: mongoose.Schema.ObjectId, ref: 'Admin', required: true, index: true },
  studentName: String,
  studentEmail: String,

  mentor: { type: mongoose.Schema.ObjectId, ref: 'Admin', index: true },
  mentorName: String,

  title: { type: String, required: true },
  problemStatement: String,
  scope: String,
  dueDate: Date,

  milestones: { type: [milestoneSchema], default: [] },
  rubric: { type: [rubricItemSchema], default: [] },

  // assigned -> in_progress -> submitted -> in_review -> (revision_requested -> submitted again) -> approved | rejected
  status: {
    type: String,
    enum: ['assigned', 'in_progress', 'submitted', 'in_review', 'revision_requested', 'approved', 'rejected'],
    default: 'assigned',
    index: true,
  },

  submissions: { type: [submissionSchema], default: [] },
  currentVersion: { type: Number, default: 0 },

  githubUrl: String, // mirrors the latest submission's, for quick listing
  deploymentUrl: String,

  finalScore: Number, // % of rubric max, from the approving review
  finalGrade: String,
  approvedAt: Date,

  createdBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  created: { type: Date, default: Date.now },
  updated: { type: Date, default: Date.now },
});

schema.index({ course: 1, student: 1 }, { unique: true });

schema.pre('save', async function (next) {
  if (this.isNew && !this.code) {
    const initials = String(this.courseTitle || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 4);
    const prefix = initials || 'PRJ';
    const count = await mongoose.model('Project').countDocuments({});
    this.code = `PRJ-${prefix}${100 + count}`;
  }
  next();
});

module.exports = mongoose.model('Project', schema);
