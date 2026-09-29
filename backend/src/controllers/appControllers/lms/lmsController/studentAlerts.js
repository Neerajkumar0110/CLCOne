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

module.exports = { unassignedCount, unassignedList };
