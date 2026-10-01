/* One-off: backfill 3 batches that were actually running before they existed
 * in the CRM — InternX-AI Foundation Plan (6 Month), trainer Vishakha
 * Bhardwaj, Mon-Fri, 6 months each. Creates the Batch row (which triggers
 * the normal post-save hook -> recurrence.js -> the full 6-month schedule of
 * LmsLiveSession rows + the persistent BBB room, exactly like creating a
 * batch from the UI), then marks every session whose scheduled window has
 * already passed as 'ended' (with actualStart/actualEnd = scheduledStart/
 * scheduledEnd) so attendance/curriculum-progress tracking sees them as
 * already delivered instead of stuck 'scheduled' forever.
 *
 * Idempotent — a batch whose name already exists is skipped entirely.
 * Usage (from backend/):  node scripts/backfillHistoricalBatches.cjs
 */
const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const COURSE = 'InternX-AI — Foundation Plan (6 Month)';
const TRAINER = 'vishakha'; // must exactly match the Teacher account's Admin.name

const BATCHES = [
  { name: 'July 2026 6 to 7:30 PM', startDate: '2026-07-01', classTime: '18:00', endTime: '19:30' },
  { name: 'July 2026 8 to 9:30 PM', startDate: '2026-07-01', classTime: '20:00', endTime: '21:30' },
  { name: 'Aug 2026 4 to 5:30 PM', startDate: '2026-08-03', classTime: '16:00', endTime: '17:30' },
];

async function waitForSessions(LmsLiveSession, batchId) {
  let count = 0;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    count = await LmsLiveSession.countDocuments({ batch: batchId, removed: false });
    if (count > 0) return count;
  }
  return count;
}

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to backfill.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  // Same reasoning as backfillRecordingClassNames.cjs: the post-save hook
  // chain (Batch -> liveClassService.onBatchCreated -> recurrence.js ->
  // ensureBatchRoom/createSession) reaches for several models via
  // mongoose.model(...) that this script never otherwise requires directly —
  // register every model up front, same as server.js's own boot.
  for (const filePath of globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js'))) {
    require(path.resolve(filePath));
  }

  const Batch = mongoose.model('Batch');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const Admin = mongoose.model('Admin');

  const trainerAccount = await Admin.findOne({ name: new RegExp(`^${TRAINER}$`, 'i'), role: 'Teacher', removed: false }).lean();
  if (!trainerAccount) {
    console.error(`No Teacher account named "${TRAINER}" found — aborting before creating anything.`);
    process.exit(1);
  }

  for (const spec of BATCHES) {
    const existing = await Batch.findOne({ name: spec.name, removed: false });
    if (existing) {
      console.log('SKIP (already exists):', spec.name);
      continue;
    }

    const batch = await new Batch({
      name: spec.name,
      course: COURSE,
      mode: 'Online',
      trainer: [TRAINER],
      classDays: 'Mon,Tue,Wed,Thu,Fri',
      classTime: spec.classTime,
      endTime: spec.endTime,
      classDurationMin: 90,
      startDate: new Date(`${spec.startDate}T00:00:00+05:30`),
      status: 'Running',
    }).save();
    console.log('Created batch:', batch.name, String(batch._id));

    const sessionCount = await waitForSessions(LmsLiveSession, batch._id);
    console.log('  sessions generated:', sessionCount);
    if (!sessionCount) {
      console.warn('  WARNING: no sessions appeared after 60s — check logs for onBatchCreated errors.');
      continue;
    }

    const now = new Date();
    const res = await LmsLiveSession.updateMany(
      { batch: batch._id, removed: false, status: { $in: ['scheduled', 'upcoming'] }, scheduledEnd: { $lt: now } },
      [{ $set: { status: 'ended', actualStart: '$scheduledStart', actualEnd: '$scheduledEnd' } }]
    );
    console.log('  marked as ended (already happened):', res.modifiedCount);
  }

  console.log('Done.');
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
