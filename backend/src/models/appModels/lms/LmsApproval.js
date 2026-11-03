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
