const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES, LMS_TEACHER_ROLES, LMS_STUDENT_ROLES } = require('../../../config/roles');

// Assignments — teacher creates/evaluates, student submits/resubmits.
//
//  teacher/manager:
//   POST   /api/lms/assignments                       { course, title, ... }
//   GET    /api/lms/assignments?course=&status=
//   GET    /api/lms/assignments/:id
//   PATCH  /api/lms/assignments/:id
//   DELETE /api/lms/assignments/:id
//   GET    /api/lms/assignments/:id/submissions
//   POST   /api/lms/submissions/:id/evaluate          { marks, grade, feedback, requestResubmission }
//  student:
//   GET    /api/lms/my/assignments
//   POST   /api/lms/assignments/:id/submit            { text, files:[{name,url}] }

const isManager = (a) => !!(a && (MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role)));
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const isStudent = (a) => !!(a && LMS_STUDENT_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });

async function ownedCourseIdsForTeacher(admin) {
  const Course = mongoose.model('Course');
  const courses = await Course.find({ removed: false, instructor: rxEq(admin.name || '') }).select('_id').lean();
  return courses.map((c) => String(c._id));
}
async function enrolledCourseIdsForStudent(admin) {
  const Student = mongoose.model('Student');
  const Course = mongoose.model('Course');
  const rows = await Student.find({ removed: false, email: rxEq(admin.email || '') }).select('course').lean();
  const titles = [...new Set(rows.map((r) => r.course).filter(Boolean))];
  if (!titles.length) return [];
  const courses = await Course.find({ removed: false, title: { $in: titles.map((t) => rxEq(t)) } }).select('_id').lean();
  return courses.map((c) => String(c._id));
}
async function assertOwnsAssignmentCourse(admin, assignment) {
  if (isManager(admin)) return true;
  if (assignment.teacherCrmUser && String(assignment.teacherCrmUser) === String(admin._id)) return true;
  const ids = await ownedCourseIdsForTeacher(admin);
  return ids.includes(String(assignment.course));
}

/* ───────────── teacher ───────────── */
async function create(req, res) {
  if (!isManager(req.admin) && !isTeacher(req.admin)) return bad(res, 403, 'Teachers only.');
  const Course = mongoose.model('Course');
  const b = req.body || {};
  if (!mongoose.isValidObjectId(b.course)) return bad(res, 400, 'A valid course is required.');
  const course = await Course.findOne({ _id: b.course, removed: false });
  if (!course) return bad(res, 404, 'Course not found.');
  if (!isManager(req.admin) && !(course.instructor && rxEq(course.instructor).test(req.admin.name || '')))
    return bad(res, 403, 'You can only add assignments to your own courses.');

  const Assignment = mongoose.model('Assignment');
  const doc = await Assignment.create({
    course: course._id,
    module: mongoose.isValidObjectId(b.module) ? b.module : undefined,
    lesson: mongoose.isValidObjectId(b.lesson) ? b.lesson : undefined,
    batch: b.batch || undefined,
    teacherCrmUser: req.admin._id,
    teacherName: req.admin.name,
    title: (b.title || 'Untitled assignment').trim(),
    description: b.description || '',
    instructions: b.instructions || '',
    startDate: b.startDate ? new Date(b.startDate) : undefined,
    dueDate: b.dueDate ? new Date(b.dueDate) : undefined,
    maxMarks: Number(b.maxMarks) || 100,
    passingMarks: Number(b.passingMarks) || 40,
    attachments: Array.isArray(b.attachments) ? b.attachments : [],
    submissionType: ['pdf', 'doc', 'image', 'text', 'file'].includes(b.submissionType) ? b.submissionType : 'file',
    allowResubmission: b.allowResubmission !== false,
    published: b.published !== false,
  });
  return ok(res, { id: String(doc._id) }, 'Assignment created.');
}

async function list(req, res) {
  const Assignment = mongoose.model('Assignment');
  const q = { removed: false };
  if (mongoose.isValidObjectId(req.query.course)) q.course = req.query.course;
  if (!isManager(req.admin)) {
    const ids = await ownedCourseIdsForTeacher(req.admin);
    q.$or = [{ teacherCrmUser: req.admin._id }, { course: { $in: ids } }];
  }
  const rows = await Assignment.find(q).sort({ dueDate: 1, created: -1 }).lean();
  const AS = mongoose.model('AssignmentSubmission');
  const counts = await AS.aggregate([
    { $match: { assignment: { $in: rows.map((r) => r._id) }, removed: { $ne: true } } },
    { $group: { _id: { a: '$assignment', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const byA = {};
  counts.forEach((c) => {
    const k = String(c._id.a);
    byA[k] = byA[k] || { submitted: 0, evaluated: 0, resubmit_requested: 0 };
    byA[k][c._id.s] = c.n;
  });
  return ok(
    res,
    rows.map((r) => ({
      id: String(r._id),
      title: r.title,
      course: String(r.course),
      dueDate: r.dueDate,
      maxMarks: r.maxMarks,
      passingMarks: r.passingMarks,
      published: r.published,
      submissions: byA[String(r._id)] || { submitted: 0, evaluated: 0, resubmit_requested: 0 },
    }))
  );
}

async function getOne(req, res) {
  const Assignment = mongoose.model('Assignment');
  const a = await Assignment.findOne({ _id: req.params.id, removed: false }).lean();
  if (!a) return bad(res, 404, 'Assignment not found.');
  return ok(res, { ...a, id: String(a._id) });
}

async function update(req, res) {
  const Assignment = mongoose.model('Assignment');
  const a = await Assignment.findOne({ _id: req.params.id, removed: false });
  if (!a) return bad(res, 404, 'Assignment not found.');
  if (!(await assertOwnsAssignmentCourse(req.admin, a))) return bad(res, 403, 'Not your assignment.');
  const F = ['title', 'description', 'instructions', 'startDate', 'dueDate', 'maxMarks', 'passingMarks', 'attachments', 'submissionType', 'allowResubmission', 'published', 'batch'];
  for (const f of F) if (req.body[f] !== undefined) a[f] = req.body[f];
  a.updated = new Date();
  await a.save();
  return ok(res, { id: String(a._id) }, 'Assignment updated.');
}

async function remove(req, res) {
  const Assignment = mongoose.model('Assignment');
  const a = await Assignment.findOne({ _id: req.params.id, removed: false });
  if (!a) return bad(res, 404, 'Assignment not found.');
  if (!(await assertOwnsAssignmentCourse(req.admin, a))) return bad(res, 403, 'Not your assignment.');
  a.removed = true;
  a.updated = new Date();
  await a.save();
  return ok(res, {}, 'Assignment removed.');
}

async function submissions(req, res) {
  const Assignment = mongoose.model('Assignment');
  const a = await Assignment.findOne({ _id: req.params.id, removed: false });
  if (!a) return bad(res, 404, 'Assignment not found.');
  if (!(await assertOwnsAssignmentCourse(req.admin, a))) return bad(res, 403, 'Not your assignment.');
  const AS = mongoose.model('AssignmentSubmission');
  const rows = await AS.find({ assignment: a._id, removed: { $ne: true } }).sort({ submittedAt: -1 }).lean();
  return ok(
    res,
    rows.map((r) => ({
      id: String(r._id),
      studentName: r.studentName,
      studentEmail: r.studentEmail,
      submittedAt: r.submittedAt,
      attempt: r.attempt,
      status: r.status,
      marks: r.marks,
      grade: r.grade,
      feedback: r.feedback,
      text: r.text,
      files: r.files || [],
    }))
  );
}

async function evaluate(req, res) {
  const AS = mongoose.model('AssignmentSubmission');
  const s = await AS.findOne({ _id: req.params.id, removed: { $ne: true } });
  if (!s) return bad(res, 404, 'Submission not found.');
  const Assignment = mongoose.model('Assignment');
  const a = await Assignment.findById(s.assignment);
  if (!a || !(await assertOwnsAssignmentCourse(req.admin, a))) return bad(res, 403, 'Not your assignment.');

  const b = req.body || {};
  if (b.requestResubmission) {
    s.status = 'resubmit_requested';
    s.feedback = b.feedback || s.feedback;
  } else {
    if (b.marks != null) s.marks = Math.max(0, Math.min(a.maxMarks, Number(b.marks) || 0));
    if (b.grade !== undefined) s.grade = b.grade;
    if (b.feedback !== undefined) s.feedback = b.feedback;
    s.status = 'evaluated';
    s.evaluatedBy = req.admin._id;
    s.evaluatedByName = req.admin.name;
    s.evaluatedAt = new Date();
  }
  s.updated = new Date();
  await s.save();

  // mirror avg score onto the Student roster row (best-effort)
  try {
    const Student = mongoose.model('Student');
    const AllForStudent = await AS.find({ student: s.student, status: 'evaluated', marks: { $ne: null } }).select('marks assignment').lean();
    if (AllForStudent.length) {
      const avg = Math.round(AllForStudent.reduce((x, y) => x + (y.marks || 0), 0) / AllForStudent.length);
      const course = await mongoose.model('Course').findById(a.course).select('title').lean();
      if (course?.title) await Student.updateMany({ email: rxEq(s.studentEmail || ''), course: course.title, removed: false }, { $set: { avgScore: avg, updated: new Date() } });
    }
  } catch (e) {
    /* non-fatal */
  }

  return ok(res, { id: String(s._id), status: s.status }, 'Saved.');
}

/* ───────────── student ───────────── */
async function myList(req, res) {
  const Assignment = mongoose.model('Assignment');
  const AS = mongoose.model('AssignmentSubmission');
  const courseIds = isManager(req.admin) || isTeacher(req.admin) ? null : await enrolledCourseIdsForStudent(req.admin);
  const q = { removed: false, published: true };
  if (courseIds) {
    if (!courseIds.length) return ok(res, []);
    q.course = { $in: courseIds };
  }
  const [rows, subs, courses] = await Promise.all([
    Assignment.find(q).sort({ dueDate: 1 }).lean(),
    AS.find({ student: req.admin._id, removed: { $ne: true } }).lean(),
    mongoose.model('Course').find({ removed: false }).select('title').lean(),
  ]);
  const cName = {};
  courses.forEach((c) => { cName[String(c._id)] = c.title; });
  const subByA = {};
  subs.forEach((s) => { subByA[String(s.assignment)] = s; });
  return ok(
    res,
    rows.map((r) => {
      const s = subByA[String(r._id)];
      return {
        id: String(r._id),
        title: r.title,
        course: cName[String(r.course)] || '',
        description: r.description,
        instructions: r.instructions,
        dueDate: r.dueDate,
        maxMarks: r.maxMarks,
        passingMarks: r.passingMarks,
        submissionType: r.submissionType,
        allowResubmission: r.allowResubmission,
        attachments: r.attachments || [],
        mySubmission: s
          ? { status: s.status, marks: s.marks, grade: s.grade, feedback: s.feedback, submittedAt: s.submittedAt, attempt: s.attempt, text: s.text, files: s.files || [] }
          : null,
      };
    })
  );
}

async function submit(req, res) {
  if (!isStudent(req.admin) && !isManager(req.admin)) return bad(res, 403, 'Students only.');
  const Assignment = mongoose.model('Assignment');
  const a = await Assignment.findOne({ _id: req.params.id, removed: false, published: true });
  if (!a) return bad(res, 404, 'Assignment not found.');

  // enrollment check
  if (!isManager(req.admin)) {
    const ids = await enrolledCourseIdsForStudent(req.admin);
    if (!ids.includes(String(a.course))) return bad(res, 403, 'You are not enrolled in this course.');
  }

  const AS = mongoose.model('AssignmentSubmission');
  let s = await AS.findOne({ assignment: a._id, student: req.admin._id });
  const b = req.body || {};
  const files = Array.isArray(b.files) ? b.files.filter((f) => f && f.url) : [];
  if (!b.text && !files.length) return bad(res, 400, 'Attach a file or write your answer.');

  if (s) {
    if (s.status === 'evaluated') return bad(res, 409, 'This submission has already been evaluated.');
    if (s.status === 'submitted' && !a.allowResubmission) return bad(res, 409, 'Resubmission is not allowed.');
    s.text = b.text || '';
    s.files = files;
    s.submittedAt = new Date();
    s.attempt = (s.attempt || 1) + (s.status === 'resubmit_requested' ? 1 : 0);
    s.status = 'submitted';
    s.updated = new Date();
    await s.save();
  } else {
    s = await AS.create({
      assignment: a._id,
      course: a.course,
      student: req.admin._id,
      studentName: req.admin.name,
      studentEmail: req.admin.email,
      text: b.text || '',
      files,
      status: 'submitted',
    });
  }
  return ok(res, { id: String(s._id), status: s.status }, 'Submitted.');
}

module.exports = { create, list, getOne, update, remove, submissions, evaluate, myList, submit };
