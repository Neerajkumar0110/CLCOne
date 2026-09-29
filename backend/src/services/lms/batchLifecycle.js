const mongoose = require('mongoose');
const { istMidnight } = require('./recurrence');

// Batch.status auto-progression — Open for Enrollment/Planned -> Running ->
// Completed, driven purely by startDate/endDate vs. today's IST calendar day
// (same one-way, schedule-is-authoritative approach as live classes'
// autoLifecycleTick in liveClassService.js). Never touches Cancelled (manual,
// terminal), and never moves a batch backwards.
async function autoUpdateStatuses() {
  const Batch = mongoose.model('Batch');
  const today0 = istMidnight(new Date());
  const todayEnd = new Date(today0.getTime() + 86399999);

  // -> Running: start date has arrived
  await Batch.updateMany(
    { removed: false, status: { $in: ['Planned', 'Open for Enrollment'] }, startDate: { $lte: todayEnd } },
    { $set: { status: 'Running' } }
  );

  // -> Completed: end date has passed
  await Batch.updateMany(
    { removed: false, status: { $in: ['Planned', 'Open for Enrollment', 'Running'] }, endDate: { $lt: today0 } },
    { $set: { status: 'Completed' } }
  );
}

module.exports = { autoUpdateStatuses };
