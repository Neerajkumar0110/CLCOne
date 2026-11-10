const mongoose = require('mongoose');

// Exception requests that need an Operations / Management decision (design
// A1 "Operations Manager — exception approvals", spec §17: automation only
// detects, a human approves any adverse or consequential decision). The
// requester can never decide their own request; every decision carries a
// reason and is mirrored into AuditLog.
const TYPES = [
  'Mark as Dropped',
  'Attendance dispute',
  'Deadline extension',
  'Readiness exception',
  'Eligibility override',
  'Mass message',
  'Status change',
  'Duplicate class removal',
  'Certificate correction',
  'Other',
];

const schema = new mongoose.Schema({
  removed: { type: Boolean, default: false },
  type: { type: String, enum: TYPES, required: true },
  detail: { type: String, default: '' }, // e.g. "5 days" for an extension
  learnerName: { type: String, default: '' },
  scope: { type: String, default: '' }, // batch / milestone / "All batches"
  evidence: { type: String, required: true },
  // a bulk / high-risk request needs a second approver (D-13)
  highRisk: { type: Boolean, default: false },
  // source record this request came from, e.g. the learner's Support ticket
  // a PM forwarded (design P8 "Send to Ops") — stops it being sent twice
  ref: { type: String, index: true },
  // what to do once approved — read by services/lms/approvalExecutor.js,
  // e.g. { studentId, to } for a status change, { batches, text } for a
  // mass message, { sessionId } for a duplicate class
  payload: { type: mongoose.Schema.Types.Mixed },
  // the automatic follow-through after the final approval: done (applied by
  // the system), manual (a person must act — the requester is told), failed
  execution: {
    status: { type: String, enum: ['done', 'manual', 'failed'] },
    at: Date,
    note: String,
  },

  requestedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  requestedByName: String,
  requestedByRole: String,

  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  approvals: [
    {
      by: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
      byName: String,
      at: Date,
    },
  ],
  decidedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  decidedByName: String,
  decidedAt: Date,
  decisionReason: String,

  created: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('LmsApproval', schema);
module.exports.TYPES = TYPES;
