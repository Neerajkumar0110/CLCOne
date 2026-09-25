const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES, LMS_TEACHER_ROLES } = require('../../../../config/roles');

// Student learning surface:
//   GET  /api/lms/learn                       -> my courses + progress
//   GET  /api/lms/learn/:courseId             -> outline + my progress + resume
//   POST /api/lms/lessons/:id/progress        { watchedSeconds, positionSec, percent, completed }
//   POST /api/lms/lessons/:id/complete
//
// A learner can open a course if a Student roster row links them to it (by
// email + course title), or if they're a manager / the course's teacher
// (preview). Progress is per (crmUser, lesson); CourseProgress is rolled up
// on every write.

const isManager = (a) => !!(a && (MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role)));
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const clampPct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

// course _ids this learner is enrolled in (via the Student roster, matched on
// email + course title)
async function learnerCourseIds(admin) {
  const Student = mongoose.model('Student');
  const Course = mongoose.model('Course');
  const email = (admin.email || '').trim();
  if (!email) return [];
  const rows = await Student.find({ removed: false, email: rxEq(email) }).select('course').lean();
  const titles = [...new Set(rows.map((r) => r.course).filter(Boolean))];
  if (!titles.length) return [];
  const courses = await Course.find({ removed: false, title: { $in: titles.map((t) => rxEq(t)) } }).select('_id').lean();
  return courses.map((c) => String(c._id));
}

async function canAccessCourse(admin, courseId) {
  if (isManager(admin)) return true;
  const Course = mongoose.model('Course');
  const course = await Course.findOne({ _id: courseId, removed: false });
  if (!course) return false;
  if (isTeacher(admin) && course.instructor && rxEq(course.instructor).test(admin.name || '')) return true;
  const ids = await learnerCourseIds(admin);
  return ids.includes(String(courseId));
}

// Every batch this learner's Student roster row(s) put them on — spec §11
// "content access can be batch/plan/role based" (Lesson.restrictToBatches).
async function myBatchNames(admin) {
  const Student = mongoose.model('Student');
  const email = (admin.email || '').trim();
  if (!email) return new Set();
  const rows = await Student.find({ removed: false, email: rxEq(email) }).select('batch').lean();
  return new Set(rows.map((r) => r.batch).filter(Boolean));
}

// True if this lesson would actually be openable right now — used by both
// courseOutline (to mark locked lessons in the tree) and lessonDetail (to
// actually enforce it server-side, not just cosmetically in the list).
// `precedingCompleted` — whether the immediately-previous lesson in course
// order is complete for this student — is passed in since computing it
// requires the caller's already-built flat order + progress map.
function lockStateFor(lesson, { precedingCompleted, batchNames } = {}) {
  if (lesson.releaseAt && new Date(lesson.releaseAt) > new Date()) {
    return { locked: true, lockReason: 'scheduled', releaseAt: lesson.releaseAt };
  }
  if (lesson.lockUntilPrevious && precedingCompleted === false) {
    return { locked: true, lockReason: 'prerequisite' };
  }
  if (lesson.restrictToBatches && lesson.restrictToBatches.length) {
    const has = batchNames && [...batchNames].some((b) => lesson.restrictToBatches.includes(b));
    if (!has) return { locked: true, lockReason: 'batch' };
  }
  return { locked: false };
}

async function myCourses(req, res) {
  const Course = mongoose.model('Course');
  const CourseProgress = mongoose.model('CourseProgress');
  const ids = await learnerCourseIds(req.admin);
  if (!ids.length) return ok(res, []);
  const [courses, progs] = await Promise.all([
    Course.find({ _id: { $in: ids }, removed: false }).select('title code thumbnailUrl instructor level durationHours status modules lessons').lean(),
    CourseProgress.find({ crmUser: req.admin._id, course: { $in: ids } }).lean(),
  ]);
  const pById = {};
  progs.forEach((p) => { pById[String(p.course)] = p; });
  return ok(
    res,
    courses.map((c) => {
      const p = pById[String(c._id)] || {};
      return {
        id: String(c._id),
        title: c.title,
        code: c.code,
        instructor: c.instructor,
        level: c.level,
        thumbnailUrl: c.thumbnailUrl,
        durationHours: c.durationHours,
        modules: c.modules || 0,
        lessons: c.lessons || 0,
        progress: p.percent || 0,
        completedLessons: p.completedLessons || 0,
        totalLessons: p.totalLessons || c.lessons || 0,
        lastLesson: p.lastLesson ? String(p.lastLesson) : null,
      };
    })
  );
}

async function courseOutline(req, res) {
  const { courseId } = req.params;
  if (!mongoose.isValidObjectId(courseId)) return bad(res, 400, 'Invalid course id.');
  if (!(await canAccessCourse(req.admin, courseId))) return bad(res, 403, 'You are not enrolled in this course.');

  const Course = mongoose.model('Course');
  const CourseModule = mongoose.model('CourseModule');
  const Chapter = mongoose.model('Chapter');
  const Lesson = mongoose.model('Lesson');
  const LessonProgress = mongoose.model('LessonProgress');

  const preview = isManager(req.admin) || isTeacher(req.admin);
  const lessonFilter = { course: courseId, removed: false };
  if (!preview) lessonFilter.published = true;

  const [course, modules, chapters, lessons, progress] = await Promise.all([
    Course.findById(courseId).lean(),
    CourseModule.find({ course: courseId, removed: false }).sort({ order: 1 }).lean(),
    Chapter.find({ course: courseId, removed: false }).sort({ order: 1 }).lean(),
    Lesson.find(lessonFilter).sort({ order: 1 }).lean(),
    LessonProgress.find({ crmUser: req.admin._id, course: courseId }).lean(),
  ]);

  const progByLesson = {};
  progress.forEach((p) => { progByLesson[String(p.lesson)] = p; });

  // Managers/teachers preview everything unlocked — matches the existing
  // `published` filter bypass above.
  const batchNames = preview ? null : await myBatchNames(req.admin);
  let prevLessonId = null; // course-wide order, spans chapter boundaries

  const flat = []; // ordered lesson ids for prev/next + resume
  const tree = modules.map((m) => ({
    id: String(m._id),
    title: m.title,
    description: m.description,
    order: m.order,
    chapters: chapters
      .filter((c) => String(c.module) === String(m._id))
      .map((c) => ({
        id: String(c._id),
        title: c.title,
        order: c.order,
        lessons: lessons
          .filter((l) => String(l.chapter) === String(c._id))
          .map((l) => {
            const p = progByLesson[String(l._id)] || {};
            flat.push(String(l._id));
            const precedingCompleted = prevLessonId ? (progByLesson[prevLessonId]?.status || 'not_started') === 'completed' : true;
            const lock = preview ? { locked: false } : lockStateFor(l, { precedingCompleted, batchNames });
            prevLessonId = String(l._id);
            return {
              id: String(l._id),
              title: l.title,
              type: l.type,
              durationSec: l.durationSec || 0,
              isPreview: !!l.isPreview,
              status: p.status || 'not_started',
              percent: p.percent || 0,
              ...lock,
            };
          }),
      })),
  }));

  const completed = progress.filter((p) => p.status === 'completed').length;
  const totalLessons = flat.length;
  const cp = progress.length
    ? { percent: totalLessons ? Math.round((completed / totalLessons) * 100) : 0, completedLessons: completed, totalLessons }
    : { percent: 0, completedLessons: 0, totalLessons };

  // resume = first not-completed lesson, else last lesson
  const resume =
    flat.find((id) => (progByLesson[id]?.status || 'not_started') !== 'completed') || flat[flat.length - 1] || null;

  return ok(res, {
    course: { id: String(course._id), title: course.title, instructor: course.instructor, description: course.description, thumbnailUrl: course.thumbnailUrl },
    modules: tree,
    order: flat,
    resume,
    progress: cp,
    canEdit: preview,
  });
}

async function lessonDetail(req, res) {
  const Lesson = mongoose.model('Lesson');
  const l = await Lesson.findOne({ _id: req.params.id, removed: false }).lean();
  if (!l) return bad(res, 404, 'Lesson not found.');
  if (!(await canAccessCourse(req.admin, l.course))) return bad(res, 403, 'You are not enrolled in this course.');

  const LessonProgress = mongoose.model('LessonProgress');
  const p = await LessonProgress.findOne({ crmUser: req.admin._id, lesson: l._id }).lean();

  // Spec §11 "prerequisite locking" — actually enforced here (not just
  // cosmetic in courseOutline's tree) — previously any enrolled student
  // could fetch any lesson's content directly by id regardless of order.
  if (!isManager(req.admin) && !isTeacher(req.admin)) {
    let precedingCompleted = true;
    if (l.lockUntilPrevious) {
      const CourseModule = mongoose.model('CourseModule');
      const Chapter = mongoose.model('Chapter');
      const [modules, chapters, siblingLessons] = await Promise.all([
        CourseModule.find({ course: l.course, removed: false }).select('_id order').sort({ order: 1 }).lean(),
        Chapter.find({ course: l.course, removed: false }).select('_id module order').sort({ order: 1 }).lean(),
        Lesson.find({ course: l.course, removed: false, published: true }).select('_id chapter order').sort({ order: 1 }).lean(),
      ]);
      const chapterOrder = new Map(chapters.map((c, i) => [String(c._id), i]));
      const moduleOrderOf = new Map(chapters.map((c) => [String(c._id), String(c.module)]));
      const moduleIdx = new Map(modules.map((m, i) => [String(m._id), i]));
      const flatIds = siblingLessons
        .slice()
        .sort((a, b) => {
          const ma = moduleIdx.get(moduleOrderOf.get(String(a.chapter))) ?? 0;
          const mb = moduleIdx.get(moduleOrderOf.get(String(b.chapter))) ?? 0;
          if (ma !== mb) return ma - mb;
          const ca = chapterOrder.get(String(a.chapter)) ?? 0;
          const cb = chapterOrder.get(String(b.chapter)) ?? 0;
          if (ca !== cb) return ca - cb;
          return (a.order || 0) - (b.order || 0);
        })
        .map((x) => String(x._id));
      const myIdx = flatIds.indexOf(String(l._id));
      const prevId = myIdx > 0 ? flatIds[myIdx - 1] : null;
      if (prevId) {
        const prevProgress = await LessonProgress.findOne({ crmUser: req.admin._id, lesson: prevId }).select('status').lean();
        precedingCompleted = (prevProgress && prevProgress.status) === 'completed';
      }
    }
    const batchNames = await myBatchNames(req.admin);
    const lock = lockStateFor(l, { precedingCompleted, batchNames });
    if (lock.locked) {
      const messages = {
        scheduled: `This lesson unlocks on ${new Date(lock.releaseAt).toLocaleString('en-IN')}.`,
        prerequisite: 'Complete the previous lesson first.',
        batch: 'This content is not available for your batch.',
      };
      return bad(res, 403, messages[lock.lockReason] || 'This lesson is locked.');
    }
  }

  // recorded lesson -> resolve a playback URL via the recording play flow
  let media = null;
  if (l.type === 'recorded' && l.recording) {
    const rec = await mongoose.model('LiveRecording').findById(l.recording).select('+playbackUrl status').lean();
    if (rec && rec.status === 'AVAILABLE') media = { kind: 'recording', url: rec.playbackUrl || null };
  }

  return ok(res, {
    id: String(l._id),
    title: l.title,
    description: l.description,
    type: l.type,
    videoSource: l.videoSource,
    videoUrl: l.type === 'video' ? l.videoUrl : undefined,
    videoId: l.videoId,
    durationSec: l.durationSec || 0,
    content: l.type === 'text' ? l.content : undefined,
    fileUrl: ['pdf', 'document'].includes(l.type) ? l.fileUrl : undefined,
    externalUrl: l.type === 'link' ? l.externalUrl : undefined,
    attachments: l.allowDownload ? l.attachments || [] : [],
    notes: l.notes,
    media,
    progress: {
      status: p?.status || 'not_started',
      percent: p?.percent || 0,
      lastPositionSec: p?.lastPositionSec || 0,
      milestones: p?.milestones || {},
    },
  });
}

async function saveProgress(req, res) {
  const Lesson = mongoose.model('Lesson');
  const l = await Lesson.findOne({ _id: req.params.id, removed: false });
  if (!l) return bad(res, 404, 'Lesson not found.');
  if (!(await canAccessCourse(req.admin, l.course))) return bad(res, 403, 'You are not enrolled in this course.');

  const LessonProgress = mongoose.model('LessonProgress');
  const body = req.body || {};
  const durationSec = Number(body.durationSec) || l.durationSec || 0;
  const watchedSeconds = Math.max(0, Number(body.watchedSeconds) || 0);
  let percent = clampPct(body.percent != null ? body.percent : durationSec ? (watchedSeconds / durationSec) * 100 : 0);
  const completed = body.completed === true || percent >= 95;
  if (completed) percent = 100;

  let p = await LessonProgress.findOne({ crmUser: req.admin._id, lesson: l._id });
  if (!p) {
    p = new LessonProgress({ crmUser: req.admin._id, lesson: l._id, course: l.course, module: l.module });
  }
  p.durationSec = durationSec;
  p.watchedSeconds = Math.max(p.watchedSeconds || 0, watchedSeconds);
  p.percent = Math.max(p.percent || 0, percent);
  if (body.positionSec != null) p.lastPositionSec = Math.max(0, Number(body.positionSec) || 0);
  p.milestones = p.milestones || {};
  p.milestones.started = true;
  if (p.percent >= 25) p.milestones.p25 = true;
  if (p.percent >= 50) p.milestones.p50 = true;
  if (p.percent >= 75) p.milestones.p75 = true;
  if (completed) {
    p.milestones.p100 = true;
    p.status = 'completed';
    if (!p.completedAt) p.completedAt = new Date();
  } else if (p.status !== 'completed') {
    p.status = 'started';
  }
  p.updated = new Date();
  await p.save();

  const rolled = await rollUpCourse(req.admin._id, l.course, l._id);
  return ok(res, { lesson: { status: p.status, percent: p.percent }, course: rolled }, 'Progress saved.');
}

async function markComplete(req, res) {
  req.body = { ...(req.body || {}), completed: true, percent: 100 };
  return saveProgress(req, res);
}

async function rollUpCourse(crmUser, courseId, lastLessonId) {
  const Lesson = mongoose.model('Lesson');
  const LessonProgress = mongoose.model('LessonProgress');
  const CourseProgress = mongoose.model('CourseProgress');
  const Student = mongoose.model('Student');

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
        lastLesson: lastLessonId,
        lastActivityAt: now,
        updated: now,
        ...(percent >= 100 ? { completedAt: now } : {}),
      },
      $setOnInsert: { created: now },
    },
    { upsert: true }
  );

  // mirror onto the Student roster row (drives the CRM Students tab + dashboards)
  try {
    const admin = await mongoose.model('Admin').findById(crmUser).select('email').lean();
    const course = await mongoose.model('Course').findById(courseId).select('title').lean();
    if (admin?.email && course?.title) {
      await Student.updateMany(
        { email: new RegExp(`^${admin.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), course: course.title, removed: false },
        { $set: { progress: percent, updated: now } }
      );
    }
  } catch (e) {
    /* non-fatal */
  }

  // course finished → let the certificate engine check the criteria
  if (percent >= 100) {
    try {
      require('../../../../services/lms/certificateEngine').evaluateSafe(crmUser, courseId);
    } catch (e) {
      /* non-fatal */
    }
  }

  return { percent, completedLessons: completed, totalLessons: total };
}

// GET /api/lms/learn/:courseId/search?q= — spec §11 "search and filters by
// unit/topic/session" — previously courseOutline's full-tree fetch was the
// only way to browse content, with no query endpoint at all.
async function searchContent(req, res) {
  const { courseId } = req.params;
  if (!mongoose.isValidObjectId(courseId)) return bad(res, 400, 'Invalid course id.');
  if (!(await canAccessCourse(req.admin, courseId))) return bad(res, 403, 'You are not enrolled in this course.');

  const q = String(req.query.q || '').trim();
  if (!q) return ok(res, { modules: [], chapters: [], lessons: [] });
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const preview = isManager(req.admin) || isTeacher(req.admin);

  const lessonFilter = { course: courseId, removed: false, $or: [{ title: rx }, { description: rx }] };
  if (!preview) lessonFilter.published = true;

  const [modules, chapters, lessons] = await Promise.all([
    mongoose.model('CourseModule').find({ course: courseId, removed: false, $or: [{ title: rx }, { description: rx }] }).select('title order').lean(),
    mongoose.model('Chapter').find({ course: courseId, removed: false, $or: [{ title: rx }, { description: rx }, { sessionLabel: rx }] }).select('title module order').lean(),
    mongoose.model('Lesson').find(lessonFilter).select('title type chapter module order').lean(),
  ]);

  return ok(res, {
    modules: modules.map((m) => ({ id: String(m._id), title: m.title })),
    chapters: chapters.map((c) => ({ id: String(c._id), title: c.title, module: String(c.module) })),
    lessons: lessons.map((l) => ({ id: String(l._id), title: l.title, type: l.type, chapter: String(l.chapter) })),
  });
}

module.exports = { myCourses, courseOutline, lessonDetail, saveProgress, markComplete, searchContent };
