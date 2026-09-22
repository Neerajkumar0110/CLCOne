const mongoose = require('mongoose');

// One entry point for the LMS-wide audit trail (AuditLog model). Best-effort
// and never throws — an audit-write failure must never block the action it
// is recording.
async function record({ module, action, entityType, entityId, admin, reason, before, after, meta } = {}) {
  try {
    const AuditLog = mongoose.model('AuditLog');
    await AuditLog.create({
      module,
      action,
      entityType,
      entityId: mongoose.isValidObjectId(entityId) ? entityId : undefined,
      performedBy: admin && admin._id,
      performedByName: admin && admin.name,
      performedByRole: admin && admin.role,
      reason,
      before,
      after,
      meta,
    });
  } catch (e) {
    console.error('[lms] auditLog.record failed:', e.message);
  }
}

async function listFor({ module, entityId, limit = 200 } = {}) {
  const AuditLog = mongoose.model('AuditLog');
  const q = {};
  if (module) q.module = module;
  if (entityId && mongoose.isValidObjectId(entityId)) q.entityId = entityId;
  return AuditLog.find(q).sort({ created: -1 }).limit(limit).lean();
}

module.exports = { record, listFor };
