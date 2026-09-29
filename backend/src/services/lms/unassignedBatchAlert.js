const mongoose = require('mongoose');

// Shared by the Students-tab count badge (lmsController/panel.js) and the
// daily reminder email to Support (jobs/lmsUnassignedBatchTick.js) — one
// definition of "unassigned" so the badge and the email can never disagree.
// A blank/whitespace-only batch string counts as unassigned, not just a
// missing field.
const UNASSIGNED_QUERY = { removed: false, status: { $ne: 'Dropped' }, $or: [{ batch: null }, { batch: '' }] };

async function countUnassigned() {
  const Student = mongoose.model('Student');
  return Student.countDocuments(UNASSIGNED_QUERY);
}

async function listUnassigned(limit = 200) {
  const Student = mongoose.model('Student');
  return Student.find(UNASSIGNED_QUERY)
    .select('name email phone course enrolledOn created')
    .sort({ created: -1 })
    .limit(limit)
    .lean();
}

module.exports = { UNASSIGNED_QUERY, countUnassigned, listUnassigned };
