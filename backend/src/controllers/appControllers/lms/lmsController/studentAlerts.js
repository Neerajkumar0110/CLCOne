const { unassignedBatchAlert } = require('../../../../services/lms');

// GET /api/lms/students/unassigned-count — powers the badge on the Students
// tab (LMS section, main CRM sidebar). Same query the daily reminder email
// to Support uses (see jobs/lmsUnassignedBatchTick.js) —
// services/lms/unassignedBatchAlert.js is the one shared definition of
// "unassigned" for both.
async function unassignedCount(req, res) {
  const count = await unassignedBatchAlert.countUnassigned();
  return res.status(200).json({ success: true, result: { count } });
}

// GET /api/lms/students/unassigned-list — the actual rows, for the
// Students tab's "Show unassigned only" toggle (ModuleScaffold/index.jsx) so
// there's a concrete place to SEE and act on them, not just a count.
async function unassignedList(req, res) {
  const rows = await unassignedBatchAlert.listUnassigned(500);
  return res.status(200).json({
    success: true,
    result: rows.map((r) => ({ ...r, id: String(r._id) })),
  });
}

// 2026-11-27 — Candidates tab "Show deleted": soft-deleted candidates
// (removed: true from the generic CRUD delete) and a restore. Restore goes
// through findOneAndUpdate so Student.js's hooks recount the batch and
// re-sync the LMS login hold, exactly like the delete did.
const escapeRe = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function deletedList(req, res) {
  const mongoose = require('mongoose');
  const rows = await mongoose
    .model('Student')
    .find({ removed: true })
    .select('name email phone course batch status created')
    .sort({ _id: -1 })
    .limit(500)
    .lean();
  return res.status(200).json({ success: true, result: rows.map((r) => ({ ...r, id: String(r._id) })) });
}

async function restore(req, res) {
  const mongoose = require('mongoose');
  const Student = mongoose.model('Student');
  const prev = await Student.findOne({ _id: req.params.id, removed: true }).select('email name').lean();
  if (!prev) return res.status(404).json({ success: false, result: null, message: 'No deleted candidate with this id.' });
  // never bring back a second copy of someone who was re-added meanwhile
  const clash = await Student.findOne({ _id: { $ne: prev._id }, removed: { $ne: true }, email: new RegExp(`^${escapeRe(prev.email)}$`, 'i') })
    .select('_id')
    .lean();
  if (clash) return res.status(409).json({ success: false, result: null, message: `An active candidate with ${prev.email} already exists — restoring would create a duplicate.` });
  const doc = await Student.findOneAndUpdate({ _id: prev._id }, { $set: { removed: false } }, { new: true, actor: req.admin });
  try {
    await require('../../../../services/lms/auditLog').record({ module: 'student', action: 'restore', entityType: 'Student', entityId: prev._id, admin: req.admin, reason: (req.body && req.body.reason) || '' });
  } catch (e) {
    /* audit is best-effort */
  }
  return res.status(200).json({ success: true, result: { id: String(doc._id) }, message: `${prev.name} restored.` });
}

module.exports = { unassignedCount, unassignedList, deletedList, restore };
