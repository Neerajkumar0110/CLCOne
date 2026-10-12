const mongoose = require('mongoose');
const {
  autoAdvance,
  orderedChaptersForCourse,
  resolveCourseForBatch,
  completionForBatch,
} = require('../../../../services/lms/chapterProgress');

// Manager-wide curriculum tracking: EVERY batch and how far through its
// course it is, in one call.
//
//   GET /api/lms/admin/curriculum/overview
//
// The Curriculum Tracker page was built around a teacher, who sees only the
// batches they train — its batch list comes from the teacher dashboard,
// which filters on Batch.trainer matching the signed-in user's name. A
// manager is not a trainer on anything, so that list came back empty and the
// whole page looked broken for exactly the person who needs to see all of
// it. This endpoint is the manager's equivalent: no trainer filter, every
// batch, each with its own progress.
//
// Routes gate this with requireManager.

const ok = (res, result, message) => res.status(200).json({ success: true, result, message });

// Progress for one batch. Returns null when the batch has no native
// curriculum to measure against (no matching Course, or a course with no
// chapters) — the caller reports that as "not tracked" rather than 0%,
// because 0% would read as "nothing taught yet" which is a different thing.
async function progressFor(batchDoc) {
  const course = await resolveCourseForBatch(batchDoc);
  if (!course) return null;

  const chapters = await orderedChaptersForCourse(course._id);
  if (!chapters.length) return null;

  // Self-healing: recomputes delivery from the batch's actual completed
  // classes before we read it, same as every other caller.
  await autoAdvance(batchDoc._id).catch(() => null);
  const completion = await completionForBatch(batchDoc._id);

  const deliveredChapters = chapters.filter((c) => completion.has(String(c._id)));

  // Units (CourseModule) only count once every chapter under them is
  // delivered — a unit half-taught is not a unit done.
  const byModule = new Map();
  for (const ch of chapters) {
    const k = String(ch.module);
    if (!byModule.has(k)) byModule.set(k, []);
    byModule.get(k).push(ch);
  }
  let completedUnits = 0;
  for (const chs of byModule.values()) {
    if (chs.every((c) => completion.has(String(c._id)))) completedUnits += 1;
  }

  // When the most recent chapter was actually delivered — the single most
  // useful "is this batch moving?" signal in a list of many.
  let lastDeliveredAt = null;
  for (const row of completion.values()) {
    if (row.completedAt && (!lastDeliveredAt || row.completedAt > lastDeliveredAt)) lastDeliveredAt = row.completedAt;
  }

  // Where the batch is right now, by name, so the list answers "what are
  // they on?" without drilling in.
  const nextChapter = chapters.find((c) => !completion.has(String(c._id)));

  return {
    courseTitle: course.title,
    totalChapters: chapters.length,
    deliveredChapters: deliveredChapters.length,
    percent: chapters.length ? Math.round((deliveredChapters.length / chapters.length) * 100) : 0,
    totalUnits: byModule.size,
    completedUnits,
    lastDeliveredAt,
    nextChapter: nextChapter ? (nextChapter.sessionLabel ? `${nextChapter.sessionLabel} — ${nextChapter.title}` : nextChapter.title) : null,
  };
}

async function overview(req, res) {
  const Batch = mongoose.model('Batch');
  const LmsLiveSession = mongoose.model('LmsLiveSession');

  const batches = await Batch.find({ removed: false })
    .select('_id name course trainer startDate endDate')
    .sort({ name: 1 })
    .lean();

  // Class counts in one aggregate rather than two queries per batch.
  const HELD = ['ended', 'recording_processing', 'recording_available'];
  const counts = await LmsLiveSession.aggregate([
    { $match: { removed: false, status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: '$batch',
        total: { $sum: 1 },
        held: { $sum: { $cond: [{ $in: ['$status', HELD] }, 1, 0] } },
      },
    },
  ]);
  const classCount = new Map(counts.map((c) => [String(c._id), c]));

  const rows = [];
  for (const b of batches) {
    // eslint-disable-next-line no-await-in-loop
    const progress = await progressFor(b).catch(() => null);
    const c = classCount.get(String(b._id)) || { total: 0, held: 0 };
    rows.push({
      id: String(b._id),
      name: b.name,
      course: b.course || '',
      trainer: b.trainer || '',
      startDate: b.startDate || null,
      endDate: b.endDate || null,
      classesTotal: c.total,
      classesHeld: c.held,
      // null = this batch has no native curriculum mapped, so there is
      // nothing to be a percentage of.
      tracked: !!progress,
      ...(progress || {}),
    });
  }

  const tracked = rows.filter((r) => r.tracked);
  const summary = {
    batches: rows.length,
    trackedBatches: tracked.length,
    untrackedBatches: rows.length - tracked.length,
    avgPercent: tracked.length ? Math.round(tracked.reduce((a, r) => a + r.percent, 0) / tracked.length) : 0,
    classesHeld: rows.reduce((a, r) => a + r.classesHeld, 0),
    classesTotal: rows.reduce((a, r) => a + r.classesTotal, 0),
  };

  return ok(res, { summary, batches: rows }, 'ok');
}

module.exports = { overview };
