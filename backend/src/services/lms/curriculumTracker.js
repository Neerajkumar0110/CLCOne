const mongoose = require('mongoose');

// Auto-progresses a batch's Curriculum Delivery Tracker (AssessmentCurriculumSession
// / AssessmentDeliveryRecord — see lmsController/assessments/curriculumController.js)
// off its ACTUAL completed live classes, instead of requiring a teacher to
// click "Mark Delivered" by hand for every session.
//
// Progress is measured in HOURS, not in class count. A curriculum unit
// carries its own `hours` (AssessmentCurriculumSession.hours — the
// FOUNDATION track mixes 1.5, 3, 4.5, 6, 7.5, 9, 18 and 45 hour units), so
// a unit is rarely one class. This used to advance one unit per class,
// which ran far ahead of reality: a batch 72 classes in (108 hours, which
// is 48 units) was shown as having delivered 72 units, all the way to
// "S133-S136 Containerisation with Docker" — content nobody had reached.
//
// Each class contributes its own scheduled length to a running total, and
// a unit is DELIVERED only once that total covers the unit in full, dated
// to the class that completed it. Same hour-accumulating walk
// services/lms/chapterProgress.js uses for the native curriculum.
// Never touches a unit a teacher already resolved by hand (SKIPPED, or
// DELIVERED with its own note/date) — only fills PENDING ones forward.
//
// THE CALENDAR IS THE SOURCE OF TRUTH. A unit is delivered because a class
// that teaches syllabus actually happened on the calendar, and for no other
// reason. Two consequences:
//
//  - A class that teaches no syllabus does not count. Orientation, the
//    fixed induction week (config/inductionWeek.js), a doubt-clearing or
//    revision hour all carry countsTowardSyllabus:false and are skipped,
//    so a batch still doing orientation is not shown as having covered the
//    first units of Python.
//
//  - The calendar can shrink as well as grow. A class cancelled, or pushed
//    off a holiday, means a unit that was auto-marked delivered has not
//    been taught after all — those are retracted to PENDING. Only records
//    this function set itself (auto:true) are ever retracted.

// FOUNDATION/ELITE are the only two curriculum tracks that exist (seeded
// content) — a batch's own Course duration (months) decides which one
// actually matches it, instead of a teacher having to pick by hand and
// risk the wrong track's units/hours for that batch's real program length.
async function trackForBatch(batchDoc) {
  if (!batchDoc || !batchDoc.course) return 'FOUNDATION';
  const Course = mongoose.model('Course');
  const course = await Course.findOne({ title: batchDoc.course, removed: false }).select('durationHours').lean();
  return course && Number(course.durationHours) > 6 ? 'ELITE' : 'FOUNDATION';
}

async function autoAdvance(batchId) {
  if (!batchId) return;
  const Batch = mongoose.model('Batch');
  const batchDoc = await Batch.findById(batchId).select('name course').lean();
  if (!batchDoc) return;

  const track = await trackForBatch(batchDoc);
  const AssessmentCurriculumSession = mongoose.model('AssessmentCurriculumSession');
  const AssessmentDeliveryRecord = mongoose.model('AssessmentDeliveryRecord');

  const units = await AssessmentCurriculumSession.find({ track }).sort({ order: 1 }).select('_id title').lean();
  if (!units.length) return;

  // What the Calendar says. chapterProgress walks the batch's real classes
  // (skipping any that teach no syllabus) and marks Chapters delivered; this
  // reads that result rather than recomputing anything.
  const chapterProgress = require('./chapterProgress');
  const course = await chapterProgress.resolveCourseForBatch(batchDoc);
  if (!course) return;
  const chapters = await chapterProgress.orderedChaptersForCourse(course._id);
  if (!chapters.length) return;
  await chapterProgress.autoAdvance(batchId).catch(() => null);
  const deliveredChapters = await chapterProgress.completionForBatch(batchId);

  // The two curricula are the same syllabus entered twice — 84 Chapters
  // against 77 AssessmentCurriculumSessions, with the same topic titles but
  // different grouping, so their S-numbers drift apart (the Calendar calls
  // "Feature Importance & Model Explainability" S71, the tracker calls it
  // S68). Matching on the title is what actually lines them up; matching on
  // the code does not, and the independent hour-walk this used to do landed
  // the tracker several topics behind what the Calendar showed.
  const titleKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const chapterByTitle = new Map(chapters.map((c) => [titleKey(c.title), c]));

  // The frontier: the last tracker unit whose Calendar chapter has been
  // delivered. Everything up to it counts as delivered, which also carries
  // the handful of units that have no Chapter counterpart at all (a few
  // micro-tests) — they sit inside taught territory, so they are taught.
  let frontier = -1;
  const dateFor = [];
  for (let i = 0; i < units.length; i += 1) {
    const ch = chapterByTitle.get(titleKey(units[i].title));
    if (!ch) continue;
    const row = deliveredChapters.get(String(ch._id));
    if (!row) continue;
    frontier = i;
    dateFor[i] = row.completedAt || null;
  }
  const n = frontier + 1;

  const existing = await AssessmentDeliveryRecord.find({ batch: batchDoc.name })
    .select('sessionId status auto')
    .lean();
  const bySession = new Map(existing.map((r) => [r.sessionId, r]));

  // Forward: everything up to the frontier is delivered.
  let lastDate = null;
  for (let i = 0; i < n; i += 1) {
    if (dateFor[i]) lastDate = dateFor[i];
    const unitId = units[i]._id;
    const rec = bySession.get(unitId);
    // A teacher's own decision stands — only fill in PENDING, or refresh a
    // date this function set itself.
    if (rec && rec.status !== 'PENDING' && !rec.auto) continue;
    // eslint-disable-next-line no-await-in-loop
    await AssessmentDeliveryRecord.findOneAndUpdate(
      { sessionId: unitId, batch: batchDoc.name },
      {
        $set: { status: 'DELIVERED', actualDate: dateFor[i] || lastDate || null, auto: true, updatedAt: new Date() },
        $setOnInsert: { sessionId: unitId, batch: batchDoc.name },
      },
      { upsert: true }
    ).catch(() => {});
  }

  // Backward: anything this function previously marked past the frontier no
  // longer has a delivered class behind it — the Calendar lost one, or a
  // class turned out to be orientation. Put it back to PENDING so the
  // tracker never claims a topic the Calendar has not reached.
  const beyond = units.slice(n).map((x) => x._id);
  if (beyond.length) {
    await AssessmentDeliveryRecord.updateMany(
      { batch: batchDoc.name, sessionId: { $in: beyond }, auto: true, status: 'DELIVERED' },
      { $set: { status: 'PENDING', actualDate: null, updatedAt: new Date() } }
    ).catch(() => {});
  }
}

// % of this batch's own curriculum currently DELIVERED — used to
// progressively unlock the proctored assessments below.
//
// Prefers the NATIVE Course/Module/Chapter curriculum ("S1", "S2-3"... —
// see services/lms/chapterProgress.js) when this batch's course actually has
// one built: it's the more accurate, hour-weighted tracker, and the same one
// a student/teacher already sees as checkmarks in the "Full Curriculum"
// modal, so "curriculum complete" means the same thing everywhere instead of
// two different %s. Measured in whole UNITS (CourseModule), not raw chapter
// count, so a test only ever unlocks once an entire unit has actually been
// finished — never off partial progress into a unit that's still mid-way.
// Falls back to the ported assessment-syllabus tracker
// (AssessmentCurriculumSession/AssessmentDeliveryRecord) for any course that
// doesn't have native chapters built yet.
async function completionPercentForBatchName(batchName) {
  if (!batchName) return 0;
  const Batch = mongoose.model('Batch');
  const batchDoc = await Batch.findOne({ name: batchName, removed: false }).select('_id name course').lean();
  if (!batchDoc) return 0;

  try {
    const chapterProgress = require('./chapterProgress');
    const course = await chapterProgress.resolveCourseForBatch(batchDoc);
    if (course) {
      const chapters = await chapterProgress.orderedChaptersForCourse(course._id);
      if (chapters.length) {
        const unitProgress = await chapterProgress.unitProgressForBatch(batchDoc._id);
        if (unitProgress) return unitProgress.percent;
      }
    }
  } catch (e) {
    /* fall through to the legacy tracker below — best-effort */
  }

  const track = await trackForBatch(batchDoc);
  const AssessmentCurriculumSession = mongoose.model('AssessmentCurriculumSession');
  const AssessmentDeliveryRecord = mongoose.model('AssessmentDeliveryRecord');
  const units = await AssessmentCurriculumSession.find({ track }).select('_id').lean();
  if (!units.length) return 0;
  const delivered = await AssessmentDeliveryRecord.countDocuments({
    batch: batchName,
    sessionId: { $in: units.map((u) => u._id) },
    status: 'DELIVERED',
  });
  return Math.round((delivered / units.length) * 100);
}

// Sequential unlock — Basic is the entry test and always open; the other
// four unlock in this order as the batch's own curriculum delivery reaches
// each %, so a student can't attempt a topic's test before it's actually
// been taught in their batch.
const UNLOCK_THRESHOLD_PCT = {
  BASIC: 0,
  MAJOR: 40,
  MICRO: 50,
  NLP_MAJOR: 70,
  NLP_MICRO: 80,
};

// A manager can manually open a test for a whole batch or specific
// learners ahead of the tracked % actually crossing its threshold — see
// AssessmentUnlockOverride's header comment for why. Checked for a whole
// batch (scope: 'batch') and/or one candidate (scope: 'student'); either
// one being active is enough.
async function hasUnlockOverride({ testType, batch, candidateId }) {
  const AssessmentUnlockOverride = mongoose.model('AssessmentUnlockOverride');
  const or = [];
  if (batch) or.push({ scope: 'batch', batch });
  if (candidateId) or.push({ scope: 'student', student: candidateId });
  if (!or.length) return false;
  return AssessmentUnlockOverride.exists({ testType, removed: false, $or: or });
}

// Single entry point the gate (testController.js#startTest) and both
// dashboard views (getMyResults/getBatchProgress) all share, so "unlocked"
// means the exact same thing — curriculum % past the threshold, OR a
// manager opened it manually — everywhere a student could see it.
async function isTestUnlocked({ testType, curriculumPercent, batch, candidateId }) {
  const requiredPct = UNLOCK_THRESHOLD_PCT[testType] || 0;
  if (curriculumPercent >= requiredPct) return true;
  return !!(await hasUnlockOverride({ testType, batch, candidateId }));
}

module.exports = {
  trackForBatch,
  autoAdvance,
  completionPercentForBatchName,
  UNLOCK_THRESHOLD_PCT,
  hasUnlockOverride,
  isTestUnlocked,
};
