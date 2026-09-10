const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES, LMS_TEACHER_ROLES } = require('../../../config/roles');

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
            return {
              id: String(l._id),
              title: l.title,
              type: l.type,
              durationSec: l.durationSec || 0,
              isPreview: !!l.isPreview,
              status: p.status || 'not_started',
              percent: p.percent || 0,
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
      require('../../../services/lms/certificateEngine').evaluateSafe(crmUser, courseId);
    } catch (e) {
      /* non-fatal */
    }
  }

  return { percent, completedLessons: completed, totalLessons: total };
}

module.exports = { myCourses, courseOutline, lessonDetail, saveProgress, markComplete };
