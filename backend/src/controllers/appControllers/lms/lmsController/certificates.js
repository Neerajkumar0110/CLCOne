const mongoose = require('mongoose');
const { LMS_FULL_ACCESS_ROLES, LMS_TEACHER_ROLES } = require('../../../../config/roles');
const certEngine = require('../../../../services/lms/certificateEngine');
const certPdf = require('../../../../services/lms/certificatePdf');
const { isTeacherOfCourse } = require('../../../../services/lms');

//  teacher/manager:
//   GET   /api/lms/courses/:courseId/certificate-rule
//   POST  /api/lms/courses/:courseId/certificate-rule   (upsert)
//   POST  /api/lms/certificates/issue                   { course, studentEmail, force? }
//   POST  /api/lms/certificates/run/:courseId           (re-check all enrolled students)
//   GET   /api/lms/certificates?course=                 (issued history)
//   GET   /api/lms/certificates/roster                  (who's in which batch, who's completed)
//   GET   /api/lms/certificates/:id/download             (PDF, any issued candidate)
//  student:
//   GET   /api/lms/my/certificates
//   GET   /api/lms/my/certificates/:id/download           (PDF, own only)
//  anyone (bearer):
//   GET   /api/lms/certificates/verify/:certificateId

const isManager = (a) => !!(a && LMS_FULL_ACCESS_ROLES.includes(a.role));
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
  if (isTeacher(admin) && (await isTeacherOfCourse(admin, course))) return course;
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
  if (!user) return bad(res, 404, 'Candidate account not found for that email.');
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
  return ok(res, { checked, issued }, `Checked ${checked} candidates, issued ${issued}.`);
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

// Resolves the real person + course behind a Certificate row (which only
// stores denormalized name/course strings) so the PDF renderer can pull
// their live assessment/project/attendance data.
async function resolveCertificateSubject(cert) {
  const Course = mongoose.model('Course');
  const Student = mongoose.model('Student');
  const Admin = mongoose.model('Admin');
  const course = await Course.findOne({ title: rxEq(cert.course || ''), removed: false }).lean();
  const roster = await Student.findOne({ name: rxEq(cert.student || ''), course: rxEq(cert.course || ''), removed: false })
    .select('email batch').lean();
  const admin = roster && roster.email
    ? await Admin.findOne({ email: rxEq(roster.email), removed: false }).select('_id email').lean()
    : null;
  return {
    course,
    adminId: admin ? admin._id : null,
    adminEmail: admin ? admin.email : (roster ? roster.email : null),
    batchName: cert.batch || (roster ? roster.batch : null),
  };
}

async function streamCertificatePdf(res, cert) {
  const { course, adminId, adminEmail, batchName } = await resolveCertificateSubject(cert);
  const buf = await certPdf.renderCertificatePdf({ cert, course, adminId, adminEmail, batchName });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${String(cert.certificateId || 'certificate').replace(/[^a-z0-9-]/gi, '_')}.pdf"`);
  res.send(buf);
}

// Gated exactly like mine() — only an Issued/Sent certificate exists for a
// candidate, and that only happens once certificateEngine's criteria (course
// %, attendance %, quiz %, assignments — see CertificateRule) are actually
// met, so "can download" already means "course is complete".
async function downloadMine(req, res) {
  const Certificate = mongoose.model('Certificate');
  const cert = await Certificate.findOne({
    _id: req.params.id,
    removed: false,
    student: rxEq(req.admin.name || ''),
    status: { $in: ['Issued', 'Sent'] },
  }).lean();
  if (!cert) return bad(res, 404, 'Certificate not found — finish the course to earn one.');
  await streamCertificatePdf(res, cert);
}

async function downloadForManager(req, res) {
  const Certificate = mongoose.model('Certificate');
  const cert = await Certificate.findOne({ _id: req.params.id, removed: false, status: { $in: ['Issued', 'Sent'] } }).lean();
  if (!cert) return bad(res, 404, 'Certificate not found.');
  if (!isManager(req.admin)) {
    const Course = mongoose.model('Course');
    const course = await Course.findOne({ title: rxEq(cert.course || ''), removed: false }).select('instructor').lean();
    if (!course || !(await isTeacherOfCourse(req.admin, course))) return bad(res, 403, 'Not your course.');
  }
  await streamCertificatePdf(res, cert);
}

// Admin/Super Admin/Support (and a Teacher, scoped to their own courses) —
// per-batch roster: headcount, how many have actually been issued a
// certificate (= completed, per the same gate downloadMine/mine use), and
// each candidate's own status.
async function roster(req, res) {
  if (!isManager(req.admin) && !isTeacher(req.admin)) return bad(res, 403, 'Managers/teachers only.');
  const Student = mongoose.model('Student');
  const Certificate = mongoose.model('Certificate');
  const q = { removed: false };
  if (!isManager(req.admin)) {
    const Course = mongoose.model('Course');
    const mine = await Course.find({ removed: false, instructor: rxEq(req.admin.name || '') }).select('title').lean();
    q.course = { $in: mine.map((c) => rxEq(c.title)) };
  }
  const students = await Student.find(q).select('name email course batch status progress').sort({ batch: 1, name: 1 }).lean();
  const certs = await Certificate.find({ removed: false, status: { $in: ['Issued', 'Sent'] } })
    .select('student course certificateId issuedOn grade score').lean();
  const certByKey = new Map();
  certs.forEach((c) => certByKey.set(`${(c.student || '').toLowerCase()}|${(c.course || '').toLowerCase()}`, c));

  const batches = new Map();
  students.forEach((s) => {
    const key = s.batch || '—';
    if (!batches.has(key)) batches.set(key, { batch: key, course: s.course || '', total: 0, completed: 0, students: [] });
    const row = batches.get(key);
    const cert = certByKey.get(`${(s.name || '').toLowerCase()}|${(s.course || '').toLowerCase()}`);
    row.total += 1;
    if (cert) row.completed += 1;
    row.students.push({
      name: s.name,
      email: s.email,
      status: s.status,
      progress: s.progress || 0,
      certificate: cert ? { id: String(cert._id), certificateId: cert.certificateId, issuedOn: cert.issuedOn, grade: cert.grade, score: cert.score } : null,
    });
  });
  return ok(res, [...batches.values()]);
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

module.exports = { getRule, upsertRule, issue, runForCourse, history, mine, verify, downloadMine, downloadForManager, roster };
