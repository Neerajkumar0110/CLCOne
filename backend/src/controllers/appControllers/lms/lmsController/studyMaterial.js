const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { LMS_FULL_ACCESS_ROLES, LMS_TEACHER_ROLES } = require('../../../../config/roles');
const { lmsConfig, isTeacherOfCourse } = require('../../../../services/lms');

// Study Material — teacher-uploaded files (or a pasted link), scoped to
// EITHER a single batch OR a whole course so a student only ever sees
// material for a batch/course they're actually enrolled in. Course-scoped
// material reaches every batch of that course automatically — including one
// added to the course after the upload — without re-uploading per batch.
// Same two-scope shape as engagement.js's announcements (course/batch-owned,
// teacher manages own uploads, manager sees/manages everything).
//
//  POST   /api/lms/materials          (teacher/manager) multipart file + { batch? | course?, title?, subject? }
//  POST   /api/lms/materials/link     (teacher/manager) { batch? | course?, url, title?, subject? }
//  GET    /api/lms/materials          (teacher = own uploads; manager = all)
//  DELETE /api/lms/materials/:id
//  GET    /api/lms/my/materials       (student — own batch/course only)

const isManager = (a) => !!(a && LMS_FULL_ACCESS_ROLES.includes(a.role));
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });

function crmBase() {
  return lmsConfig.meeting.crmBaseUrl.replace(/\/+$/, '');
}

function kindFromMime(mime, name) {
  const m = mime || '';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m === 'application/pdf' || /\.pdf$/i.test(name || '')) return 'pdf';
  return 'other';
}

async function assertOwnsBatch(admin, batch) {
  if (isManager(admin)) return true;
  const Batch = mongoose.model('Batch');
  return !!(await Batch.exists({ removed: false, name: batch, trainer: rxEq(admin.name || '') }));
}

// Resolves { batch? , course? } from the request body into a validated
// scope ready to save — at most one of the two, same "exactly one" shape
// Announcement's audience uses. Returns { error } on anything invalid, or
// { batch } / { course: ObjectId, courseTitle } on success.
async function resolveScope(admin, b) {
  const batch = String(b.batch || '').trim();
  const courseId = String(b.course || '').trim();

  if (courseId) {
    if (!mongoose.isValidObjectId(courseId)) return { errorCode: 400, error: 'Invalid course.' };
    const Course = mongoose.model('Course');
    const course = await Course.findOne({ _id: courseId, removed: false }).lean();
    if (!course) return { errorCode: 404, error: 'Course not found.' };
    if (!isManager(admin) && !(await isTeacherOfCourse(admin, course))) return { errorCode: 403, error: 'Not your course.' };
    return { course: course._id, courseTitle: course.title };
  }

  if (batch) {
    if (!(await assertOwnsBatch(admin, batch))) return { errorCode: 403, error: 'Not your batch.' };
    return { batch };
  }

  return { errorCode: 400, error: 'Pick a batch or a course.' };
}

function serialize(r) {
  return {
    id: String(r._id),
    title: r.title,
    subject: r.subject || '',
    batch: r.batch || '',
    course: r.course ? String(r.course) : '',
    courseTitle: r.courseTitle || '',
    kind: r.kind,
    sourceType: r.sourceType,
    fileUrl: r.fileUrl,
    originalName: r.originalName || '',
    mimeType: r.mimeType || '',
    sizeBytes: r.sizeBytes || 0,
    teacherName: r.teacherName,
    uploadedAt: r.uploadedAt,
  };
}

async function upload(req, res) {
  if (!isManager(req.admin) && !isTeacher(req.admin)) return bad(res, 403, 'Instructors only.');
  const b = req.body || {};
  const scope = await resolveScope(req.admin, b);
  if (scope.error) return bad(res, scope.errorCode, scope.error);
  if (!req.file) return bad(res, 400, 'No file uploaded.');

  // req.file.path is relative to process.cwd() (multer's diskStorage
  // destination, see middlewares/uploadMiddleware/singleStorageUpload.js) —
  // confirm the write actually landed before we tell the student it's
  // available, instead of persisting a record that 404s on every view.
  const writtenAt = path.resolve(process.cwd(), req.file.path);
  if (!fs.existsSync(writtenAt)) {
    console.error(`[studyMaterial.upload] multer reported a write but the file is missing: ${writtenAt} (req.file=${JSON.stringify(req.file)})`);
    return bad(res, 500, 'Upload did not save correctly. Please try again.');
  }

  const StudyMaterial = mongoose.model('StudyMaterial');
  const originalName = req.file.originalname;
  const title = (b.title && b.title.trim()) || originalName.replace(/\.[^.]+$/, '');

  const doc = await StudyMaterial.create({
    teacherCrmUser: req.admin._id,
    teacherName: req.admin.name,
    title,
    subject: (b.subject || '').trim(),
    ...scope,
    kind: kindFromMime(req.file.mimetype, originalName),
    sourceType: 'file',
    fileUrl: `${crmBase()}/${req.body.file}`,
    originalName,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  });
  return ok(res, serialize(doc), 'Uploaded.');
}

async function addLink(req, res) {
  if (!isManager(req.admin) && !isTeacher(req.admin)) return bad(res, 403, 'Instructors only.');
  const b = req.body || {};
  const url = String(b.url || '').trim();
  if (!url) return bad(res, 400, 'Paste a URL.');
  if (!/^https?:\/\//i.test(url)) return bad(res, 400, 'Enter a valid http(s) URL.');
  const scope = await resolveScope(req.admin, b);
  if (scope.error) return bad(res, scope.errorCode, scope.error);

  const StudyMaterial = mongoose.model('StudyMaterial');
  const doc = await StudyMaterial.create({
    teacherCrmUser: req.admin._id,
    teacherName: req.admin.name,
    title: (b.title && b.title.trim()) || url,
    subject: (b.subject || '').trim(),
    ...scope,
    kind: 'other',
    sourceType: 'link',
    fileUrl: url,
  });
  return ok(res, serialize(doc), 'Link added.');
}

async function list(req, res) {
  const StudyMaterial = mongoose.model('StudyMaterial');
  const q = { removed: false };
  if (!isManager(req.admin)) q.teacherCrmUser = req.admin._id;
  // By title, not upload time — a folder upload's files land in whatever
  // order the browser happened to traverse the directory tree in, which has
  // nothing to do with "01 Python + SQL" belonging before "02 ...". Title
  // carries the folder path for a folder upload (see uploadFiles' webkitRelativePath
  // title), so this naturally reconstructs the course's intended sequence —
  // same reasoning as Recordings sorting by class date instead of compression order.
  const rows = await StudyMaterial.find(q).sort({ title: 1 }).limit(500).lean();
  return ok(res, rows.map(serialize));
}

async function remove(req, res) {
  const StudyMaterial = mongoose.model('StudyMaterial');
  const m = await StudyMaterial.findOne({ _id: req.params.id, removed: false });
  if (!m) return bad(res, 404, 'Not found.');
  if (!isManager(req.admin) && String(m.teacherCrmUser) !== String(req.admin._id)) return bad(res, 403, 'Not yours.');
  m.removed = true;
  m.updated = new Date();
  await m.save();
  return ok(res, {}, 'Removed.');
}

// Always resolved live off the student's CURRENT roster row, never a
// one-time snapshot — so a newly-created candidate sees whatever course/
// batch material already exists the moment their roster row is saved with
// a batch/course, with no separate "assign material to this student" step.
async function mine(req, res) {
  const StudyMaterial = mongoose.model('StudyMaterial');
  const Student = mongoose.model('Student');
  const Course = mongoose.model('Course');
  const rows0 = await Student.find({ removed: false, email: rxEq(req.admin.email || '') }).select('batch course').lean();
  const batches = [...new Set(rows0.map((r) => r.batch).filter(Boolean))];
  const courseTitles = [...new Set(rows0.map((r) => r.course).filter(Boolean))];
  const courses = courseTitles.length
    ? await Course.find({ removed: false, title: { $in: courseTitles.map((t) => rxEq(t)) } }).select('_id').lean()
    : [];
  const courseIds = courses.map((c) => c._id);
  if (!batches.length && !courseIds.length) return ok(res, []);
  const rows = await StudyMaterial.find({
    removed: false,
    $or: [...(batches.length ? [{ batch: { $in: batches } }] : []), ...(courseIds.length ? [{ course: { $in: courseIds } }] : [])],
  })
    .sort({ title: 1 })
    .limit(500)
    .lean();
  return ok(res, rows.map(serialize));
}

module.exports = { upload, addLink, list, remove, mine };
