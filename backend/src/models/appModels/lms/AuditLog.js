const mongoose = require('mongoose');

// General-purpose "who changed what, when, why" trail for sensitive LMS
// admin actions (policy publish/archive, attendance correction, assessment
// result override, project approval, eligibility override, ...). Spec §17:
// every sensitive change must record who/what/when/reason. Write-only from
// the app's perspective — services/lms/auditLog.js is the only writer.
const schema = new mongoose.Schema({
  module: { type: String, required: true, index: true }, // 'policy' | 'attendance' | 'assessment' | 'project' | 'eligibility' | ...
  action: { type: String, required: true }, // 'create' | 'publish' | 'archive' | 'acknowledge' | 'correct' | 'override' | ...
  entityType: { type: String, required: true },
  entityId: { type: mongoose.Schema.ObjectId, index: true },

  performedBy: { type: mongoose.Schema.ObjectId, ref: 'Admin' },
  performedByName: String,
  performedByRole: String,

  reason: String,
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  meta: mongoose.Schema.Types.Mixed,

  created: { type: Date, default: Date.now, index: true },
});

schema.index({ module: 1, entityId: 1, created: -1 });

module.exports = mongoose.model('AuditLog', schema);
