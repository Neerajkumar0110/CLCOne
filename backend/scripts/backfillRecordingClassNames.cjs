/* One-off backfill: existing LiveRecording rows were named from
 * LmsLiveSession.title, which is just "<batch> — Class <n>" (set once at
 * schedule-generation time, services/lms/recurrence.js) — not the real
 * curriculum topic ("S1 — Python Setup & Environment") the Calendar shows
 * for the same class (computed on the fly by services/lms/chapterProgress.js,
 * never written back to session.title). liveClassService.js's startSession/
 * updateSchedule now resolve that topic for new/rescheduled recordings; this
 * backfills every recording already sitting in the database.
 *
 * Conservative by design: only overwrites a className that still looks like
 * the generic placeholder ("<batch> — Class <n>" or "<batch> — Live Class"),
 * so a teacher's own manual rename (anything else) is left untouched.
 *
 * Idempotent — safe to run more than once.
 * Usage (from backend/):  node scripts/backfillRecordingClassNames.cjs
 */
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const GENERIC_PATTERN = / — (Class \d+|Live Class)$/;

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to migrate.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  const LiveRecording = require('../src/models/appModels/lms/LiveRecording');
  const chapterProgress = require('../src/services/lms/chapterProgress');

  const rows = await LiveRecording.find({ removed: false }).select('batch liveSession className').lean();
  console.log(`Found ${rows.length} recording(s) to check.`);

  let updated = 0;
  let skippedNoBatch = 0;
  let skippedNotGeneric = 0;
  let skippedNoTopic = 0;

  for (const r of rows) {
    if (!r.batch || !r.liveSession) {
      skippedNoBatch += 1;
      continue;
    }
    if (!GENERIC_PATTERN.test(r.className || '')) {
      skippedNotGeneric += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const topic = await chapterProgress.topicForSession(r.batch, r.liveSession).catch(() => null);
    if (!topic || topic === r.className) {
      skippedNoTopic += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await LiveRecording.updateOne({ _id: r._id }, { $set: { className: topic, updated: new Date() } });
    updated += 1;
    console.log(`  "${r.className}" -> "${topic}"`);
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skippedNoBatch} (no batch/session), ${skippedNotGeneric} (already a custom name), ${skippedNoTopic} (no curriculum topic found).`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
