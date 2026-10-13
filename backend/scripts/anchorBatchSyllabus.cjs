/* Re-align a batch's curriculum to what is actually being taught.
 *
 * The Calendar / recording names / curriculum tracker all come from one
 * hour-based walk (services/lms/chapterProgress.js). When a batch's real
 * pace drifts from it, this pins one class to the chapter it really
 * teaches (LmsLiveSession.syllabusAnchorChapter); every later class follows
 * on from there, everywhere — student, teacher, support and admin views.
 *
 * Optional --induction: also turn the batch's first five classes BEFORE the
 * anchored one into the fixed induction week (config/inductionWeek.js), the
 * same as a newly generated batch gets.
 *
 * --revision: the class teaches no chapter (revision / doubt-clearing). The
 * second argument is then used as the class title instead, and the class is
 * marked countsTowardSyllabus:false so it consumes no curriculum hours.
 *
 * Dry run by default — prints what would change. Add --apply to write.
 *
 * Usage (from backend/):
 *   node scripts/anchorBatchSyllabus.cjs <batchName> "<chapter title text>" [--date YYYY-MM-DD] [--induction] [--revision] [--apply]
 *   --date defaults to today (IST); the first class that day is anchored.
 */
const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : null);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--date'));
const [batchName, chapterQuery] = positional;
const APPLY = flag('--apply');
const REVISION = flag('--revision');

const IST_MS = 330 * 60000;
const istDay = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

(async () => {
  if (!batchName || !chapterQuery) {
    console.error('Usage: node scripts/anchorBatchSyllabus.cjs <batchName> "<chapter title text>" [--date YYYY-MM-DD] [--induction] [--apply]');
    process.exit(1);
  }
  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  for (const f of globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js'))) require(path.resolve(f));
  const chapterProgress = require('../src/services/lms/chapterProgress');
  const liveClassService = require('../src/services/lms/liveClassService');
  const { INDUCTION_WEEK } = require('../src/config/inductionWeek');
  const Batch = mongoose.model('Batch');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LiveClass = mongoose.model('LiveClass');

  const batch = await Batch.findOne({ name: batchName, removed: { $ne: true } }).lean();
  if (!batch) throw new Error(`Batch ${batchName} not found.`);
  const course = await chapterProgress.resolveCourseForBatch(batch);
  if (!course) throw new Error(`Batch ${batchName}: course "${batch.course}" not found.`);
  const chapters = await chapterProgress.orderedChaptersForCourse(course._id);

  // Match on the chapter title, or "<label> <title>", ignoring punctuation
  // (so "S2 – S3: Variables…" and "S2–3 — Variables…" both match).
  const q = norm(chapterQuery);
  const hits = chapters.filter((c) => norm(c.title) === q || norm(`${c.sessionLabel || ''} ${c.title}`).includes(q) || norm(c.title).includes(q));
  const exact = hits.filter((c) => norm(c.title) === q);
  const pick = exact.length === 1 ? exact : hits;
  if (!REVISION && pick.length !== 1) {
    console.error(`Chapter "${chapterQuery}" matched ${pick.length} chapters in "${course.title}":`);
    (pick.length ? pick : chapters).forEach((c) => console.error(`  - ${c.sessionLabel || ''} | ${c.title}`));
    process.exit(1);
  }
  const chapter = REVISION ? null : pick[0];

  const sessions = await LmsLiveSession.find({ batch: batch._id, removed: false, status: { $ne: 'cancelled' } })
    .sort({ scheduledStart: 1 })
    .lean();
  const day = opt('--date') || istDay(new Date());
  const target = sessions.find((s) => s.scheduledStart && istDay(s.scheduledStart) === day);
  if (!target) throw new Error(`Batch ${batchName} has no class on ${day}.`);

  const before = await chapterProgress.autoAdvance(batch._id);
  const label = (s) => chapterProgress.formatTopic(before && before.sessionTopics[String(s._id)]) || s.title;

  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} — ${batchName} (${course.title})`);
  console.log(`  class on ${day}: #${target.sessionIndex} "${label(target)}"`);
  console.log(REVISION ? `  -> revision class: "${chapterQuery}" (no syllabus consumed)` : `  -> anchored to: ${chapter.sessionLabel || ''} — ${chapter.title}`);

  let induction = [];
  if (flag('--induction')) {
    induction = sessions.filter((s) => s.scheduledStart < target.scheduledStart).slice(0, INDUCTION_WEEK.length);
    induction.forEach((s, i) => console.log(`  induction: ${istDay(s.scheduledStart)} #${s.sessionIndex} "${label(s)}" -> "${INDUCTION_WEEK[i].title}"`));
    if (!induction.length) console.log('  induction: no classes before this one — nothing to convert.');
  }

  if (APPLY) {
    for (let i = 0; i < induction.length; i += 1) {
      const s = induction[i];
      const { title, description } = INDUCTION_WEEK[i];
      await LmsLiveSession.updateOne({ _id: s._id }, { $set: { title, description, countsTowardSyllabus: false, updated: new Date() } });
      if (s.liveClass) await LiveClass.updateOne({ _id: s.liveClass }, { $set: { topic: title, agenda: description, updated: new Date() } });
    }
    if (REVISION) {
      await LmsLiveSession.updateOne({ _id: target._id }, { $set: { title: chapterQuery, countsTowardSyllabus: false, updated: new Date() } });
      if (target.liveClass) await LiveClass.updateOne({ _id: target.liveClass }, { $set: { topic: chapterQuery, updated: new Date() } });
    } else {
      await LmsLiveSession.updateOne({ _id: target._id }, { $set: { syllabusAnchorChapter: chapter._id, updated: new Date() } });
    }
    const { updated } = await liveClassService.resyncBatchRecordingNames(batch._id);
    await require('../src/services/lms/curriculumTracker').autoAdvance(batch._id);
    console.log(`  recordings renamed: ${updated}`);
  }

  const after = await chapterProgress.autoAdvance(batch._id);
  const tail = sessions.filter((s) => s.scheduledStart >= target.scheduledStart).slice(0, 4);
  console.log(APPLY ? '  now:' : '  (after --apply the anchor takes effect; current projection shown)');
  tail.forEach((s) => console.log(`    ${istDay(s.scheduledStart)} #${s.sessionIndex} ${chapterProgress.formatTopic(after && after.sessionTopics[String(s._id)]) || s.title}`));

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
