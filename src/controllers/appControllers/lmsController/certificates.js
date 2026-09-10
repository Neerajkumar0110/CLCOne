const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES, LMS_TEACHER_ROLES } = require('../../../config/roles');
const certEngine = require('../../../services/lms/certificateEngine');

//  teacher/manager:
//   GET   /api/lms/courses/:courseId/certificate-rule
//   POST  /api/lms/courses/:courseId/certificate-rule   (upsert)
//   POST  /api/lms/certificates/issue                   { course, studentEmail, force? }
//   POST  /api/lms/certificates/run/:courseId           (re-check all enrolled students)
//   GET   /api/lms/certificates?course=                 (issued history)
//  student:
//   GET   /api/lms/my/certificates
//  anyone (bearer):
//   GET   /api/lms/certificates/verify/:certificateId

const isManager = (a) => !!(a && (MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role)));
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });

async function assertOwnsCourse(admin, courseId) {
  const Course = mongoose.model('Course');
  if (!mongoose.isValidObjectId(courseId)) return null;
  const course = await Course.findOne({ _id: courseId, removed: false });
  if (!course) return null;
  if (isManager(admin)) return course;
  if (isTeacher(admin) && course.instructor && rxEq(course.instructor).test(admin.name || '')) return course;
  return null;
}

async function getRule(req, res) {
  const course = await assertOwnsCourse(req.admin, req.params.courseId);
  if (!course) return bad(res, 403, 'Not your course.');
  const CertificateRule = mongoose.model('CertificateRule');
  const rule = await CertificateRule.findOne({ course: course._id, removed: { $ne: true } }).lean();
  return ok(res, rule ? { ...rule, id: String(rule._id) } : null);
}

async function upsertRule(req, res) {
  const course = await assertOwnsCourse(req.admin, req.params.courseId);
  if (!course) return bad(res, 403, 'Not your course.');
  const CertificateRule = mongoose.model('CertificateRule');
  const b = req.body || {};
  const set = {
    courseTitle: course.title,
    title: b.title || 'Certificate of Completion',
    type: ['Completion', 'Participation', 'Merit', 'Achievement'].includes(b.type) ? b.type : 'Completion',
    minCoursePercent: clamp(b.minCoursePercent, 0, 100, 100),
    minAttendancePercent: clamp(b.minAttendancePercent, 0, 100, 0),
    requireAllAssignments: !!b.requireAllAssignments,
    minQuizPercent: clamp(b.minQuizPercent, 0, 100, 0),
    autoIssue: b.autoIssue !== false,
    validMonths: Math.max(0, Number(b.validMonths) || 0),
    enabled: b.enabled !== false,
    updated: new Date(),
  };
  const rule = await CertificateRule.findOneAndUpdate(
    { course: course._id },
    { $set: set, $setOnInsert: { course: course._id, created: new Date() } },
    { upsert: true, new: true }
  );
  return ok(res, { id: String(rule._id) }, 'Certificate rule saved.');
}

function clamp(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

async function issue(req, res) {
  const b = req.body || {};
  const course = await assertOwnsCourse(req.admin, b.course);
  if (!course) return bad(res, 403, 'Not your course.');
  const Admin = mongoose.model('Admin');
  const user = b.studentEmail
    ? await Admin.findOne({ email: rxEq(b.studentEmail), removed: false }).select('_id').lean()
    : mongoose.isValidObjectId(b.studentId)
      ? await Admin.findById(b.studentId).select('_id').lean()
      : null;
  if (!user) return bad(res, 404, 'Student account not found for that email.');
  const r = await certEngine.evaluate(user._id, course._id, { force: !!b.force, byName: req.admin.name });
  return ok(res, r, r.issued ? 'Certificate issued.' : r.already ? 'Already issued.' : `Not eligible: ${JSON.stringify(r.checks)}`);
}

async function runForCourse(req, res) {
  const course = await assertOwnsCourse(req.admin, req.params.courseId);
  if (!course) return bad(res, 403, 'Not your course.');
  const Student = mongoose.model('Student');
  const Admin = mongoose.model('Admin');
  const roster = await Student.find({ course: rxEq(course.title), removed: false }).select('email').lean();
  const emails = [...new Set(roster.map((r) => (r.email || '').toLowerCase()).filter(Boolean))];
  const admins = await Admin.find({ email: { $in: emails }, removed: false }).select('_id').lean();
  let issued = 0;
  let checked = 0;
  for (const a of admins) {
    checked += 1;
    const r = await certEngine.evaluate(a._id, course._id, {}).catch(() => ({}));
    if (r.issued) issued += 1;
  }
  return ok(res, { checked, issued }, `Checked ${checked} students, issued ${issued}.`);
}

async function history(req, res) {
  const Certificate = mongoose.model('Certificate');
  const q = { removed: false };
  if (req.query.course) q.course = rxEq(String(req.query.course));
  if (!isManager(req.admin)) {
    // teacher: limit to their course titles
    const Course = mongoose.model('Course');
    const mine = await Course.find({ removed: false, instructor: rxEq(req.admin.name || '') }).select('title').lean();
    q.course = { $in: mine.map((c) => rxEq(c.title)) };
  }
  const rows = await Certificate.find(q).sort({ issuedOn: -1, created: -1 }).limit(500).lean();
  return ok(res, rows.map((r) => ({ ...r, id: String(r._id) })));
}

async function mine(req, res) {
  const Certificate = mongoose.model('Certificate');
  const rows = await Certificate.find({
    removed: false,
    student: rxEq(req.admin.name || ''),
    status: { $in: ['Issued', 'Sent'] },
  }).sort({ issuedOn: -1 }).lean();
  return ok(
    res,
    rows.map((r) => ({
      id: String(r._id),
      course: r.course,
      title: r.title,
      type: r.type,
      certificateId: r.certificateId,
      grade: r.grade,
      score: r.score,
      issuedOn: r.issuedOn,
      validUntil: r.validUntil,
      verificationUrl: r.verificationUrl,
    }))
  );
}

async function verify(req, res) {
  const Certificate = mongoose.model('Certificate');
  const c = await Certificate.findOne({ certificateId: req.params.certificateId, removed: false }).lean();
  if (!c) return bad(res, 404, 'No certificate with that ID.');
  return ok(res, {
    valid: ['Issued', 'Sent'].includes(c.status),
    student: c.student,
    course: c.course,
    title: c.title,
    type: c.type,
    grade: c.grade,
    score: c.score,
    issuedOn: c.issuedOn,
    validUntil: c.validUntil,
    issuedBy: c.issuedBy,
    status: c.status,
  });
}

module.exports = { getRule, upsertRule, issue, runForCourse, history, mine, verify };
