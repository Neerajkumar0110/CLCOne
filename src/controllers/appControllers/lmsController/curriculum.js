const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES } = require('../../../config/roles');

// Teacher / manager curriculum builder for a course:
//   Course → CourseModule → Chapter → Lesson
//
//   GET    /api/lms/courses/:courseId/outline
//   POST   /api/lms/courses/:courseId/modules        { title, description }
//   PATCH  /api/lms/modules/:id                      { title?, description?, order? }
//   DELETE /api/lms/modules/:id
//   POST   /api/lms/modules/:id/chapters             { title, description }
//   PATCH  /api/lms/chapters/:id
//   DELETE /api/lms/chapters/:id
//   POST   /api/lms/chapters/:id/lessons             { title, type, ... }
//   PATCH  /api/lms/lessons/:id
//   DELETE /api/lms/lessons/:id
//   POST   /api/lms/courses/:courseId/reorder        { modules:[{id,order}], chapters:[...], lessons:[...] }

const isManager = (a) => !!(a && (MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role)));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });

async function loadOwnedCourse(req, courseId) {
  const Course = mongoose.model('Course');
  if (!mongoose.isValidObjectId(courseId)) return { err: [400, 'Invalid course id.'] };
  const course = await Course.findOne({ _id: courseId, removed: false });
  if (!course) return { err: [404, 'Course not found.'] };
  if (!isManager(req.admin) && !(course.instructor && rxEq(course.instructor).test(req.admin.name || ''))) {
    return { err: [403, 'You can only edit your own courses.'] };
  }
  return { course };
}

async function nextOrder(Model, filter) {
  const last = await Model.findOne(filter).sort({ order: -1 }).select('order').lean();
  return (last && last.order != null ? last.order : 0) + 10;
}

async function outline(req, res) {
  const { course, err } = await loadOwnedCourse(req, req.params.courseId);
  if (err) return bad(res, err[0], err[1]);

  const CourseModule = mongoose.model('CourseModule');
  const Chapter = mongoose.model('Chapter');
  const Lesson = mongoose.model('Lesson');

  const [modules, chapters, lessons] = await Promise.all([
    CourseModule.find({ course: course._id, removed: false }).sort({ order: 1 }).lean(),
    Chapter.find({ course: course._id, removed: false }).sort({ order: 1 }).lean(),
    Lesson.find({ course: course._id, removed: false }).sort({ order: 1 }).lean(),
  ]);

  const tree = modules.map((m) => ({
    ...m,
    id: String(m._id),
    chapters: chapters
      .filter((c) => String(c.module) === String(m._id))
      .map((c) => ({
        ...c,
        id: String(c._id),
        lessons: lessons
          .filter((l) => String(l.chapter) === String(c._id))
          .map((l) => ({ ...l, id: String(l._id) })),
      })),
  }));

  return ok(res, {
    course: { id: String(course._id), title: course.title, status: course.status },
    modules: tree,
    counts: { modules: modules.length, chapters: chapters.length, lessons: lessons.length },
  });
}

async function addModule(req, res) {
  const { course, err } = await loadOwnedCourse(req, req.params.courseId);
  if (err) return bad(res, err[0], err[1]);
  const CourseModule = mongoose.model('CourseModule');
  const m = await CourseModule.create({
    course: course._id,
    title: (req.body.title || 'Untitled module').trim(),
    description: req.body.description || '',
    order: await nextOrder(CourseModule, { course: course._id, removed: false }),
  });
  await syncCourseCounts(course._id);
  return ok(res, { id: String(m._id) }, 'Module added.');
}

async function updateModule(req, res) {
  const CourseModule = mongoose.model('CourseModule');
  const m = await CourseModule.findOne({ _id: req.params.id, removed: false });
  if (!m) return bad(res, 404, 'Module not found.');
  const { err } = await loadOwnedCourse(req, m.course);
  if (err) return bad(res, err[0], err[1]);
  for (const f of ['title', 'description', 'order']) if (req.body[f] !== undefined) m[f] = req.body[f];
  m.updated = new Date();
  await m.save();
  return ok(res, { id: String(m._id) }, 'Module updated.');
}

async function deleteModule(req, res) {
  const CourseModule = mongoose.model('CourseModule');
  const m = await CourseModule.findOne({ _id: req.params.id, removed: false });
  if (!m) return bad(res, 404, 'Module not found.');
  const { err } = await loadOwnedCourse(req, m.course);
  if (err) return bad(res, err[0], err[1]);
  const now = new Date();
  await Promise.all([
    CourseModule.updateOne({ _id: m._id }, { $set: { removed: true, updated: now } }),
    mongoose.model('Chapter').updateMany({ module: m._id }, { $set: { removed: true, updated: now } }),
    mongoose.model('Lesson').updateMany({ module: m._id }, { $set: { removed: true, updated: now } }),
  ]);
  await syncCourseCounts(m.course);
  return ok(res, {}, 'Module removed.');
}

async function addChapter(req, res) {
  const CourseModule = mongoose.model('CourseModule');
  const m = await CourseModule.findOne({ _id: req.params.id, removed: false });
  if (!m) return bad(res, 404, 'Module not found.');
  const { err } = await loadOwnedCourse(req, m.course);
  if (err) return bad(res, err[0], err[1]);
  const Chapter = mongoose.model('Chapter');
  const c = await Chapter.create({
    course: m.course,
    module: m._id,
    title: (req.body.title || 'Untitled chapter').trim(),
    description: req.body.description || '',
    order: await nextOrder(Chapter, { module: m._id, removed: false }),
  });
  return ok(res, { id: String(c._id) }, 'Chapter added.');
}

async function updateChapter(req, res) {
  const Chapter = mongoose.model('Chapter');
  const c = await Chapter.findOne({ _id: req.params.id, removed: false });
  if (!c) return bad(res, 404, 'Chapter not found.');
  const { err } = await loadOwnedCourse(req, c.course);
  if (err) return bad(res, err[0], err[1]);
  for (const f of ['title', 'description', 'order']) if (req.body[f] !== undefined) c[f] = req.body[f];
  c.updated = new Date();
  await c.save();
  return ok(res, { id: String(c._id) }, 'Chapter updated.');
}

async function deleteChapter(req, res) {
  const Chapter = mongoose.model('Chapter');
  const c = await Chapter.findOne({ _id: req.params.id, removed: false });
  if (!c) return bad(res, 404, 'Chapter not found.');
  const { err } = await loadOwnedCourse(req, c.course);
  if (err) return bad(res, err[0], err[1]);
  const now = new Date();
  await Promise.all([
    Chapter.updateOne({ _id: c._id }, { $set: { removed: true, updated: now } }),
    mongoose.model('Lesson').updateMany({ chapter: c._id }, { $set: { removed: true, updated: now } }),
  ]);
  await syncCourseCounts(c.course);
  return ok(res, {}, 'Chapter removed.');
}

const LESSON_FIELDS = [
  'title', 'description', 'order', 'type', 'videoSource', 'videoUrl', 'durationSec', 'thumbnailUrl',
  'content', 'fileUrl', 'externalUrl', 'notes', 'isPreview', 'allowDownload', 'published', 'attachments',
  'recording', 'liveSession',
];

async function addLesson(req, res) {
  const Chapter = mongoose.model('Chapter');
  const c = await Chapter.findOne({ _id: req.params.id, removed: false });
  if (!c) return bad(res, 404, 'Chapter not found.');
  const { err } = await loadOwnedCourse(req, c.course);
  if (err) return bad(res, err[0], err[1]);
  const Lesson = mongoose.model('Lesson');
  const doc = { course: c.course, module: c.module, chapter: c._id, title: (req.body.title || 'Untitled lesson').trim() };
  for (const f of LESSON_FIELDS) if (req.body[f] !== undefined) doc[f] = req.body[f];
  doc.order = await nextOrder(Lesson, { chapter: c._id, removed: false });
  const l = await Lesson.create(doc);
  await syncCourseCounts(c.course);
  return ok(res, { id: String(l._id) }, 'Lesson added.');
}

async function updateLesson(req, res) {
  const Lesson = mongoose.model('Lesson');
  const l = await Lesson.findOne({ _id: req.params.id, removed: false });
  if (!l) return bad(res, 404, 'Lesson not found.');
  const { err } = await loadOwnedCourse(req, l.course);
  if (err) return bad(res, err[0], err[1]);
  for (const f of LESSON_FIELDS) if (req.body[f] !== undefined) l[f] = req.body[f];
  l.updated = new Date();
  await l.save();
  return ok(res, { id: String(l._id) }, 'Lesson updated.');
}

async function deleteLesson(req, res) {
  const Lesson = mongoose.model('Lesson');
  const l = await Lesson.findOne({ _id: req.params.id, removed: false });
  if (!l) return bad(res, 404, 'Lesson not found.');
  const { err } = await loadOwnedCourse(req, l.course);
  if (err) return bad(res, err[0], err[1]);
  l.removed = true;
  l.updated = new Date();
  await l.save();
  await syncCourseCounts(l.course);
  return ok(res, {}, 'Lesson removed.');
}

async function reorder(req, res) {
  const { course, err } = await loadOwnedCourse(req, req.params.courseId);
  if (err) return bad(res, err[0], err[1]);
  const map = {
    modules: mongoose.model('CourseModule'),
    chapters: mongoose.model('Chapter'),
    lessons: mongoose.model('Lesson'),
  };
  let n = 0;
  for (const key of Object.keys(map)) {
    const rows = Array.isArray(req.body[key]) ? req.body[key] : [];
    const ops = rows
      .filter((r) => r && mongoose.isValidObjectId(r.id) && Number.isFinite(Number(r.order)))
      .map((r) => ({
        updateOne: {
          filter: { _id: r.id, course: course._id },
          update: {
            $set: {
              order: Number(r.order),
              ...(r.module ? { module: r.module } : {}),
              ...(r.chapter ? { chapter: r.chapter } : {}),
              updated: new Date(),
            },
          },
        },
      }));
    if (ops.length) {
      const r = await map[key].bulkWrite(ops, { ordered: false });
      n += r.modifiedCount || 0;
    }
  }
  return ok(res, { updated: n }, 'Order saved.');
}

// keep Course.modules / Course.lessons counters roughly in sync (display only)
async function syncCourseCounts(courseId) {
  try {
    const [modules, lessons] = await Promise.all([
      mongoose.model('CourseModule').countDocuments({ course: courseId, removed: false }),
      mongoose.model('Lesson').countDocuments({ course: courseId, removed: false }),
    ]);
    await mongoose.model('Course').updateOne({ _id: courseId }, { $set: { modules, lessons } });
  } catch (e) {
    /* non-fatal */
  }
}

module.exports = {
  outline,
  addModule,
  updateModule,
  deleteModule,
  addChapter,
  updateChapter,
  deleteChapter,
  addLesson,
  updateLesson,
  deleteLesson,
  reorder,
};
