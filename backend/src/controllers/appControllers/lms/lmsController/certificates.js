const crypto = require('crypto');
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

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
function gradeForPct(pct) {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 60) return 'C';
  return 'Pass';
}

// Fully automatic completion gate for the InternX-AI program — no admin
// has to configure a CertificateRule (nobody ever did, which is why zero
// certificates existed — certificateEngine.evaluate() bails immediately
// with "no rule" otherwise). A candidate's card always shows for an
// enrolled course; the certificate only becomes issuable/downloadable once
// (a) the program's real duration (6 or 12 months — Course.durationHours,
// the same field curriculumTracker.trackForBatch reads for Foundation vs
// Elite) has actually elapsed since their real Student.enrolledOn date,
// and (b) their capstone Project has actually been submitted at least
// once (Project.currentVersion >= 1). Both are real, already-tracked data
// — nothing here is fabricated or hand-toggled by an admin.
async function checkEligibility({ adminId, course, enrolledOn }) {
  const Project = mongoose.model('Project');
  const durationMonths = Number(course.durationHours) || 6;
  const durationOk = !!enrolledOn && addMonths(enrolledOn, durationMonths) <= new Date();
  let projectOk = false;
  if (adminId) {
    const project = await Project.findOne({ course: course._id, student: adminId, removed: false })
      .sort({ updated: -1 }).select('currentVersion').lean();
    projectOk = !!project && (project.currentVersion || 0) >= 1;
  }
  return { durationOk, projectOk, eligible: durationOk && projectOk, durationMonths };
}

async function findIssuedCertificate(studentName, courseTitle) {
  const Certificate = mongoose.model('Certificate');
  return Certificate.findOne({
    removed: false,
    student: rxEq(studentName || ''),
    course: rxEq(courseTitle || ''),
    status: { $in: ['Issued', 'Sent'] },
  }).lean();
}

// Score/grade still come from the real CourseProgress %, same as
// certificateEngine — this just isn't gated on hitting any particular
// threshold, since duration-elapsed + project-submitted are the two real
// signals this program actually wants to gate on.
async function autoIssueCertificate({ adminId, adminName, course, batch }) {
  const Certificate = mongoose.model('Certificate');
  const CourseProgress = mongoose.model('CourseProgress');
  const cp = await CourseProgress.findOne({ crmUser: adminId, course: course._id }).lean();
  const coursePercent = cp ? cp.percent || 0 : 0;
  const certificateId = `CLC-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  return Certificate.create({
    student: adminName,
    course: course.title,
    batch,
    certificateId,
    title: 'Certificate of Completion',
    type: 'Completion',
    issuedOn: new Date(),
    grade: gradeForPct(coursePercent),
    score: coursePercent,
    status: 'Issued',
    verificationUrl: `/#/verify/${certificateId}`,
    issuedBy: 'System (auto)',
  });
}

async function ensureCertificate({ adminId, adminName, course, batch, enrolledOn }) {
  const elig = await checkEligibility({ adminId, course, enrolledOn });
  let cert = await findIssuedCertificate(adminName, course.title);
  if (elig.eligible && !cert && adminId) {
    cert = await autoIssueCertificate({ adminId, adminName, course, batch });
  }
  return { ...elig, cert };
}

async function mine(req, res) {
  const Student = mongoose.model('Student');
  const Course = mongoose.model('Course');
  const rows = await Student.find({ removed: false, email: rxEq(req.admin.email || '') })
    .select('course batch enrolledOn').lean();

  const out = [];
  for (const r of rows) {
    const course = await Course.findOne({ title: rxEq(r.course || ''), removed: false }).select('title durationHours').lean();
    if (!course) continue;
    const { durationOk, projectOk, eligible, durationMonths, cert } = await ensureCertificate({
      adminId: req.admin._id,
      adminName: req.admin.name,
      course,
      batch: r.batch,
      enrolledOn: r.enrolledOn,
    });
    out.push({
      id: cert ? String(cert._id) : null,
      courseId: String(course._id),
      course: course.title,
      track: durationMonths > 6 ? 'Elite Program' : 'Foundation Program',
      durationMonths,
      title: cert ? cert.title : 'Certificate of Completion',
      certificateId: cert ? cert.certificateId : null,
      grade: cert ? cert.grade : null,
      score: cert ? cert.score : null,
      issuedOn: cert ? cert.issuedOn : null,
      verificationUrl: cert ? cert.verificationUrl : null,
      eligible,
      durationOk,
      projectOk,
    });
  }
  return ok(res, out);
}

// Course is only looked up to know which real template (Foundation/Elite —
// Course.durationHours) the PDF renderer should fill in.
async function streamCertificatePdf(res, cert) {
  const Course = mongoose.model('Course');
  const course = await Course.findOne({ title: rxEq(cert.course || ''), removed: false }).select('durationHours').lean();
  const buf = await certPdf.renderCertificatePdf({ cert, course });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${String(cert.certificateId || 'certificate').replace(/[^a-z0-9-]/gi, '_')}.pdf"`);
  res.send(buf);
}

// Gated exactly like mine() — only an Issued/Sent certificate exists for a
// candidate once checkEligibility's two real conditions (duration elapsed +
// project submitted) are both true, so "can download" already means "done".
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

// A student can always LOOK at what their certificate will be — rendered
// inline (not a forced file save) with whatever's genuinely true right now
// (so an incomplete one is still honest: "—" for anything not done yet).
// Only downloadMine actually saves a file to disk, and that stays locked
// until the real cert is issued.
async function previewMine(req, res) {
  const Student = mongoose.model('Student');
  const Course = mongoose.model('Course');
  if (!mongoose.isValidObjectId(req.query.course)) return bad(res, 400, 'Course required.');
  const course = await Course.findOne({ _id: req.query.course, removed: false }).select('title durationHours').lean();
  if (!course) return bad(res, 404, 'Course not found.');
  const roster = await Student.findOne({ removed: false, email: rxEq(req.admin.email || ''), course: rxEq(course.title) })
    .select('batch').lean();
  if (!roster) return bad(res, 403, 'Not enrolled in this course.');

  const existing = await findIssuedCertificate(req.admin.name, course.title);
  const cert = existing || { student: req.admin.name, course: course.title, batch: roster.batch, certificateId: 'PREVIEW', issuedOn: null };
  const buf = await certPdf.renderCertificatePdf({ cert, course });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="certificate-preview.pdf"');
  res.send(buf);
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
  const Course = mongoose.model('Course');
  const Admin = mongoose.model('Admin');
  const q = { removed: false };
  if (!isManager(req.admin)) {
    const mine = await Course.find({ removed: false, instructor: rxEq(req.admin.name || '') }).select('title').lean();
    q.course = { $in: mine.map((c) => rxEq(c.title)) };
  }
  const students = await Student.find(q).select('name email course batch status progress enrolledOn').sort({ batch: 1, name: 1 }).lean();

  const courseTitles = [...new Set(students.map((s) => s.course).filter(Boolean))];
  const courses = courseTitles.length
    ? await Course.find({ removed: false, title: { $in: courseTitles.map((t) => rxEq(t)) } }).select('title durationHours').lean()
    : [];
  const courseByTitle = new Map(courses.map((c) => [c.title.toLowerCase(), c]));

  const emails = [...new Set(students.map((s) => s.email).filter(Boolean))];
  const admins = emails.length
    ? await Admin.find({ email: { $in: emails.map((e) => rxEq(e)) }, removed: false }).select('_id email').lean()
    : [];
  const adminByEmail = new Map(admins.map((a) => [a.email.toLowerCase(), a]));

  const batches = new Map();
  for (const s of students) {
    const key = s.batch || '—';
    if (!batches.has(key)) batches.set(key, { batch: key, course: s.course || '', total: 0, completed: 0, students: [] });
    const row = batches.get(key);
    row.total += 1;

    const course = courseByTitle.get((s.course || '').toLowerCase());
    const admin = adminByEmail.get((s.email || '').toLowerCase());
    let cert = null;
    let eligible = false;
    if (course) {
      const res2 = await ensureCertificate({ adminId: admin ? admin._id : null, adminName: s.name, course, batch: s.batch, enrolledOn: s.enrolledOn });
      cert = res2.cert;
      eligible = res2.eligible;
    }
    if (cert) row.completed += 1;
    row.students.push({
      name: s.name,
      email: s.email,
      status: s.status,
      progress: s.progress || 0,
      eligible,
      certificate: cert ? { id: String(cert._id), certificateId: cert.certificateId, issuedOn: cert.issuedOn, grade: cert.grade, score: cert.score } : null,
    });
  }
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

module.exports = { getRule, upsertRule, issue, runForCourse, history, mine, verify, downloadMine, downloadForManager, previewMine, roster };
