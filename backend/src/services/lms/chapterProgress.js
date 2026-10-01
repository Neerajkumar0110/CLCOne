const mongoose = require('mongoose');

// Auto-progresses the NATIVE Course -> CourseModule -> Chapter curriculum
// (the "Full Curriculum" modal — CurriculumViewer.jsx) off a batch's actual
// completed live classes, the same idea as services/lms/curriculumTracker.js
// but for the CRM's own curriculum builder instead of the ported assessment
// syllabus. Each class contributes its own real scheduled length (hours) to
// a running total; a Chapter is marked DELIVERED the moment that running
// total reaches its own cumulative hour mark, stamped to whichever class
// pushed it over — so "which topic got covered which day" is exact, not
// just "N classes happened -> N chapters done".

const COMPLETED_STATUSES = ['ended', 'recording_processing', 'recording_available'];

async function resolveCourseForBatch(batchDoc) {
  if (!batchDoc || !batchDoc.course) return null;
  const Course = mongoose.model('Course');
  return Course.findOne({ title: batchDoc.course, removed: false }).lean();
}

// Course-wide chapter order = module order, then chapter order within it —
// same double-sort learning.js#courseOutline already uses for lessons.
async function orderedChaptersForCourse(courseId) {
  const CourseModule = mongoose.model('CourseModule');
  const Chapter = mongoose.model('Chapter');
  const [modules, chapters] = await Promise.all([
    CourseModule.find({ course: courseId, removed: false }).sort({ order: 1 }).select('_id title order').lean(),
    Chapter.find({ course: courseId, removed: false }).select('_id module title sessionLabel hours order').lean(),
  ]);
  const moduleOrder = new Map(modules.map((m, i) => [String(m._id), i]));
  const moduleTitle = new Map(modules.map((m) => [String(m._id), m.title]));
  return chapters
    .slice()
    .sort((a, b) => {
      const mo = (moduleOrder.get(String(a.module)) ?? 999) - (moduleOrder.get(String(b.module)) ?? 999);
      return mo !== 0 ? mo : (a.order || 0) - (b.order || 0);
    })
    .map((c) => ({ ...c, moduleTitle: moduleTitle.get(String(c.module)) || '' }));
}

// Self-healing: safe to call on every read (Full Curriculum open, Calendar
// load) as well as right when a class ends. Returns the ordered chapter list
// plus a sessionId -> [{chapterId,title,sessionLabel}] map for the classes
// that were (re)walked this call, so callers don't need a second query.
//
// Walks EVERY non-cancelled session for the batch, completed or still
// upcoming — a batch's whole schedule is generated up front (recurrence.js),
// so an upcoming class's own planned length already tells you which topic it
// WILL cover once it happens, exactly like a syllabus timetable. Only
// completed classes actually persist a DELIVERED row (and count toward unit
// completion); upcoming ones just get a projected label to show in Calendar,
// carried forward from wherever the real, completed progress left off.
//
// A chapter longer than one class (e.g. a 3hr "S2-3" spanning two 1.5hr
// classes) shows up in sessionTopics for EVERY class whose hour-window
// overlaps its cumulative range, not just the one that finally completes it
// — so the Calendar shows "S2-3" on both days it was actually taught. It
// only gets marked DELIVERED (and only counts toward unit completion) once
// a class's contribution reaches its full cumulative end, never partially.
async function autoAdvance(batchId) {
  if (!batchId) return null;
  const Batch = mongoose.model('Batch');
  const batchDoc = await Batch.findById(batchId).select('name course classDurationMin').lean();
  if (!batchDoc) return null;

  const course = await resolveCourseForBatch(batchDoc);
  if (!course) return null;

  const chapters = await orderedChaptersForCourse(course._id);
  if (!chapters.length) return { chapters: [], sessionTopics: {} };

  // [start, end) cumulative hour range per chapter.
  const ranges = [];
  let running = 0;
  for (const ch of chapters) {
    const start = running;
    running += ch.hours || 0;
    ranges.push({ start, end: running });
  }

  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const allSessions = await LmsLiveSession.find({
    removed: false,
    batch: batchId,
    status: { $ne: 'cancelled' },
  })
    .select('scheduledStart actualStart scheduledDurationMin status')
    .sort({ scheduledStart: 1 })
    .lean();
  if (!allSessions.length) return { chapters, sessionTopics: {} };

  const BatchChapterProgress = mongoose.model('BatchChapterProgress');
  const defaultDurationMin = batchDoc.classDurationMin || 90;

  let deliveredHours = 0;
  const sessionTopics = {};

  for (const cls of allSessions) {
    const isCompleted = COMPLETED_STATUSES.includes(cls.status);
    const classStart = deliveredHours;
    deliveredHours += (cls.scheduledDurationMin || defaultDurationMin) / 60;
    const classEnd = deliveredHours;

    const covered = [];
    for (let i = 0; i < chapters.length; i += 1) {
      const { start, end } = ranges[i];
      // A zero-hour chapter (no duration set) has a zero-width range — bundle
      // it into whichever class's window reaches that position at all.
      const touches = end > start ? start < classEnd && end > classStart : start >= classStart && start < classEnd;
      if (!touches) continue;

      const ch = chapters[i];
      covered.push({ chapterId: String(ch._id), title: ch.title, sessionLabel: ch.sessionLabel });

      // Only tick DELIVERED once an actually-completed class's own
      // contribution reaches the chapter's full cumulative end — a chapter
      // spanning two classes shows on both days but only completes on the
      // second, and an upcoming class never writes anything, only labels.
      if (isCompleted && classEnd >= end - 1e-6) {
        // eslint-disable-next-line no-await-in-loop
        const prev = await BatchChapterProgress.findOneAndUpdate(
          { batch: batchId, chapter: ch._id },
          {
            $set: {
              status: 'DELIVERED',
              completedAt: cls.actualStart || cls.scheduledStart,
              sessionId: cls._id,
              course: course._id,
              module: ch.module,
              batchName: batchDoc.name,
              updated: new Date(),
            },
          },
          { upsert: true }
        ).catch(() => null);
        // Newly delivered this call (not just a self-heal re-confirming an
        // already-delivered chapter) — a student shouldn't have to click
        // "Mark Complete" on My Courses for a lesson whose class already
        // happened; do it for them the moment the chapter itself ticks.
        if (!prev || prev.status !== 'DELIVERED') {
          // eslint-disable-next-line no-await-in-loop
          await autoCompleteLessonsForChapter(ch._id, course._id, batchDoc.name, cls.actualStart || cls.scheduledStart).catch(() => {});
        }
      }
    }
    if (covered.length) sessionTopics[String(cls._id)] = covered;
  }

  return { chapters, sessionTopics };
}

// Same curriculum-topic label the Calendar shows for one session (e.g. "S1
// — Python Setup & Environment"), for the handful of call sites that only
// need a single session's label rather than a whole batch's map — e.g.
// LiveRecording.className, which must match what Calendar shows for the
// same class instead of the generic "<batch> — Class <n>" placeholder
// session.title holds. Returns null (caller falls back to session.title)
// when the batch has no native curriculum or no chapter covers this slot.
async function topicForSession(batchId, sessionId) {
  const advanced = await autoAdvance(batchId).catch(() => null);
  const covered = advanced && advanced.sessionTopics[String(sessionId)];
  if (!covered || !covered.length) return null;
  return covered.map((c) => (c.sessionLabel ? `${c.sessionLabel} — ${c.title}` : c.title)).join(' + ');
}

// Rolls up (crmUser, course) LessonProgress rows into the CourseProgress
// aggregate — same shape as learning.js's own (unexported) rollUpCourse, but
// kept here rather than imported from a controller so this service has no
// dependency on the controller layer.
async function rollUpCourseProgress(crmUser, courseId) {
  const Lesson = mongoose.model('Lesson');
  const LessonProgress = mongoose.model('LessonProgress');
  const CourseProgress = mongoose.model('CourseProgress');

  const [total, progs] = await Promise.all([
    Lesson.countDocuments({ course: courseId, removed: false, published: true }),
    LessonProgress.find({ crmUser, course: courseId }).select('status').lean(),
  ]);
  const completed = progs.filter((p) => p.status === 'completed').length;
  const started = progs.filter((p) => p.status !== 'not_started').length;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  const now = new Date();
  await CourseProgress.updateOne(
    { crmUser, course: courseId },
    {
      $set: {
        totalLessons: total,
        completedLessons: completed,
        startedLessons: started,
        percent,
        lastActivityAt: now,
        updated: now,
        ...(percent >= 100 ? { completedAt: now } : {}),
      },
      $setOnInsert: { created: now },
    },
    { upsert: true }
  ).catch(() => {});
}

// A chapter just ticked DELIVERED (its class actually happened) — every
// lesson under it auto-completes for every student currently on that batch,
// same as if each of them had clicked "Mark Complete" on My Courses
// themselves. Best-effort; a failure here must never break autoAdvance.
async function autoCompleteLessonsForChapter(chapterId, courseId, batchName, completedAt) {
  const Lesson = mongoose.model('Lesson');
  const lessons = await Lesson.find({ chapter: chapterId, removed: false }).select('_id module').lean();
  if (!lessons.length) return;

  const Student = mongoose.model('Student');
  const students = await Student.find({ removed: false, batch: batchName }).select('email').lean();
  const emails = [...new Set(students.map((s) => (s.email || '').toLowerCase()).filter(Boolean))];
  if (!emails.length) return;

  const Admin = mongoose.model('Admin');
  const admins = await Admin.find({ removed: false, email: { $in: emails } }).select('_id').lean();
  if (!admins.length) return;

  const LessonProgress = mongoose.model('LessonProgress');
  const now = new Date();
  const when = completedAt || now;

  for (const admin of admins) {
    for (const lesson of lessons) {
      // eslint-disable-next-line no-await-in-loop
      await LessonProgress.findOneAndUpdate(
        { crmUser: admin._id, lesson: lesson._id },
        {
          $set: {
            status: 'completed',
            percent: 100,
            completedAt: when,
            milestones: { started: true, p25: true, p50: true, p75: true, p100: true },
            updated: now,
          },
          $setOnInsert: { crmUser: admin._id, lesson: lesson._id, course: courseId, module: lesson.module },
        },
        { upsert: true }
      ).catch(() => {});
    }
    // eslint-disable-next-line no-await-in-loop
    await rollUpCourseProgress(admin._id, courseId);
  }
}

// Whole-UNIT (CourseModule) completion — a unit only counts once every one
// of its chapters is DELIVERED. Used for Assessment unlock gating instead of
// raw chapter-count %, so a test never unlocks off partial progress into a
// unit that hasn't actually been finished yet.
async function unitProgressForBatch(batchId) {
  if (!batchId) return null;
  const Batch = mongoose.model('Batch');
  const batchDoc = await Batch.findById(batchId).select('name course').lean();
  if (!batchDoc) return null;
  const course = await resolveCourseForBatch(batchDoc);
  if (!course) return null;
  const chapters = await orderedChaptersForCourse(course._id);
  if (!chapters.length) return { totalUnits: 0, completedUnits: 0, percent: 0 };

  await autoAdvance(batchId);
  const completion = await completionForBatch(batchId);

  const byModule = new Map();
  for (const ch of chapters) {
    const key = String(ch.module);
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(ch);
  }
  let completedUnits = 0;
  for (const chs of byModule.values()) {
    if (chs.every((c) => completion.has(String(c._id)))) completedUnits += 1;
  }
  const totalUnits = byModule.size;
  return { totalUnits, completedUnits, percent: totalUnits ? Math.round((completedUnits / totalUnits) * 100) : 0 };
}

// Per-unit (CourseModule) breakdown, in course order — id/title/order plus
// whether every one of its own chapters is DELIVERED. Powers the Assessment
// dashboard's one-card-per-unit view for a Foundation batch (see
// testController.js#getBatchProgress) — distinct from unitProgressForBatch's
// single aggregate %.
async function unitsForBatch(batchId) {
  if (!batchId) return null;
  const Batch = mongoose.model('Batch');
  const batchDoc = await Batch.findById(batchId).select('name course').lean();
  if (!batchDoc) return null;
  const course = await resolveCourseForBatch(batchDoc);
  if (!course) return null;

  const CourseModule = mongoose.model('CourseModule');
  const modules = await CourseModule.find({ course: course._id, removed: false }).sort({ order: 1 }).select('_id title order').lean();
  if (!modules.length) return null;

  const chapters = await orderedChaptersForCourse(course._id);
  if (!chapters.length) return null;

  await autoAdvance(batchId);
  const completion = await completionForBatch(batchId);

  const byModule = new Map();
  for (const ch of chapters) {
    const key = String(ch.module);
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(ch);
  }

  return modules.map((m, i) => {
    const chs = byModule.get(String(m._id)) || [];
    const completedChapters = chs.filter((c) => completion.has(String(c._id))).length;
    return {
      id: String(m._id),
      title: m.title,
      order: m.order != null ? m.order : i,
      totalChapters: chs.length,
      completedChapters,
      completed: chs.length > 0 && completedChapters === chs.length,
    };
  });
}

// Read-only — chapterId (string) -> BatchChapterProgress row.
async function completionForBatch(batchId) {
  const BatchChapterProgress = mongoose.model('BatchChapterProgress');
  const rows = await BatchChapterProgress.find({ batch: batchId }).lean();
  return new Map(rows.map((r) => [String(r.chapter), r]));
}

module.exports = {
  resolveCourseForBatch,
  orderedChaptersForCourse,
  autoAdvance,
  topicForSession,
  completionForBatch,
  unitProgressForBatch,
  unitsForBatch,
};
