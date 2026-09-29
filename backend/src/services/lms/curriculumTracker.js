const mongoose = require('mongoose');

// Auto-progresses a batch's Curriculum Delivery Tracker (AssessmentCurriculumSession
// / AssessmentDeliveryRecord — see lmsController/assessments/curriculumController.js)
// off its ACTUAL completed live classes, instead of requiring a teacher to
// click "Mark Delivered" by hand for every session. One curriculum unit is
// assumed per class (the batch's own default class length, ~90 min — see
// Batch.classDurationMin), so "N classes have happened" -> "the first N
// units (in order) are DELIVERED", dated to when that class actually ran.
// Never touches a unit a teacher already resolved by hand (SKIPPED, or
// DELIVERED with its own note/date) — only fills PENDING ones forward.

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
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const AssessmentCurriculumSession = mongoose.model('AssessmentCurriculumSession');
  const AssessmentDeliveryRecord = mongoose.model('AssessmentDeliveryRecord');

  const completedClasses = await LmsLiveSession.find({
    removed: false,
    batch: batchId,
    status: { $in: ['ended', 'recording_processing', 'recording_available'] },
  })
    .select('scheduledStart actualStart')
    .sort({ scheduledStart: 1 })
    .lean();
  if (!completedClasses.length) return;

  const units = await AssessmentCurriculumSession.find({ track }).sort({ order: 1 }).select('_id').lean();
  const n = Math.min(completedClasses.length, units.length);
  if (!n) return;

  const unitIds = units.slice(0, n).map((u) => u._id);
  const existing = await AssessmentDeliveryRecord.find({ batch: batchDoc.name, sessionId: { $in: unitIds } })
    .select('sessionId status')
    .lean();
  const statusBySession = new Map(existing.map((r) => [r.sessionId, r.status]));

  for (let i = 0; i < n; i++) {
    const unitId = units[i]._id;
    const currentStatus = statusBySession.get(unitId);
    if (currentStatus && currentStatus !== 'PENDING') continue; // teacher already resolved this one by hand
    const cls = completedClasses[i];
    // eslint-disable-next-line no-await-in-loop
    await AssessmentDeliveryRecord.findOneAndUpdate(
      { sessionId: unitId, batch: batchDoc.name },
      {
        $set: { status: 'DELIVERED', actualDate: cls.actualStart || cls.scheduledStart, updatedAt: new Date() },
        $setOnInsert: { sessionId: unitId, batch: batchDoc.name },
      },
      { upsert: true }
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
// two different %s. Falls back to the ported assessment-syllabus tracker
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
        await chapterProgress.autoAdvance(batchDoc._id);
        const completion = await chapterProgress.completionForBatch(batchDoc._id);
        const delivered = chapters.filter((c) => completion.has(String(c._id))).length;
        return Math.round((delivered / chapters.length) * 100);
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

module.exports = { trackForBatch, autoAdvance, completionPercentForBatchName, UNLOCK_THRESHOLD_PCT };
