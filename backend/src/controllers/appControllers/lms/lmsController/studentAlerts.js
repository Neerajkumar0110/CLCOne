const { unassignedBatchAlert } = require('../../../../services/lms');

// GET /api/lms/students/unassigned-count — powers the badge on the Students
// tab (LMS section, main CRM sidebar) and the "Raise it separately" filter
// link. Same query the daily reminder email to Support uses (see
// jobs/lmsUnassignedBatchTick.js) — services/lms/unassignedBatchAlert.js is
// the one shared definition of "unassigned" for both.
async function unassignedCount(req, res) {
  const count = await unassignedBatchAlert.countUnassigned();
  return res.status(200).json({ success: true, result: { count } });
}

module.exports = { unassignedCount };
