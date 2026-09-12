const crypto = require('crypto');
const mongoose = require('mongoose');
const { lmsConfig } = require('../../config/lms');

// Certificate criteria engine. evaluate(crmUserId, courseId) checks the
// course's CertificateRule against the student's progress / attendance /
// assignments / quizzes and, when every criterion is met and autoIssue is on,
// creates a Certificate (idempotent) and emails the student.

const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
function crmBase() {
  return lmsConfig.meeting.crmBaseUrl.replace(/\/+$/, '');
}
function gradeFor(pct) {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 60) return 'C';
  return 'Pass';
}

async function evaluate(crmUserId, courseId, opts = {}) {
  const force = !!opts.force;
  const Course = mongoose.model('Course');
  const Admin = mongoose.model('Admin');
  const CertificateRule = mongoose.model('CertificateRule');
  const CourseProgress = mongoose.model('CourseProgress');
  const Certificate = mongoose.model('Certificate');
  const Student = mongoose.model('Student');

  if (!mongoose.isValidObjectId(crmUserId) || !mongoose.isValidObjectId(courseId)) return { eligible: false, reason: 'bad ids' };

  const [course, user, rule] = await Promise.all([
    Course.findById(courseId).lean(),
    Admin.findById(crmUserId).select('name email').lean(),
    CertificateRule.findOne({ course: courseId, removed: { $ne: true } }).lean(),
  ]);
  if (!course || !user) return { eligible: false, reason: 'not found' };
  if (!rule && !force) return { eligible: false, reason: 'no rule' };

  const R = rule || { minCoursePercent: 100, minAttendancePercent: 0, requireAllAssignments: false, minQuizPercent: 0, autoIssue: true, enabled: true, title: 'Certificate of Completion', type: 'Completion', validMonths: 0 };
  if (rule && !rule.enabled && !force) return { eligible: false, reason: 'rule disabled' };

  // ── metrics ──
  const cp = await CourseProgress.findOne({ crmUser: crmUserId, course: courseId }).lean();
  const coursePercent = cp ? cp.percent || 0 : 0;

  const roster = user.email
    ? await Student.findOne({ email: rxEq(user.email), course: rxEq(course.title || ''), removed: false }).select('attendancePct batch').lean()
    : null;
  const attendancePercent = roster ? roster.attendancePct || 0 : 0;

  let assignmentsOk = true;
  if (R.requireAllAssignments) {
    const Assignment = mongoose.model('Assignment');
    const AS = mongoose.model('AssignmentSubmission');
    const total = await Assignment.countDocuments({ course: courseId, removed: false, published: true });
    if (total > 0) {
      const done = await AS.countDocuments({ course: courseId, student: crmUserId, status: 'evaluated', removed: { $ne: true } });
      assignmentsOk = done >= total;
    }
  }

  let quizPercent = 100;
  if (R.minQuizPercent > 0) {
    const QuizAttempt = mongoose.model('QuizAttempt');
    const atts = await QuizAttempt.find({ course: courseId, student: crmUserId, status: 'evaluated' }).select('percent').lean();
    quizPercent = atts.length ? Math.round(atts.reduce((a, b) => a + (b.percent || 0), 0) / atts.length) : 0;
  }

  const checks = {
    course: coursePercent >= (R.minCoursePercent || 0),
    attendance: attendancePercent >= (R.minAttendancePercent || 0),
    assignments: assignmentsOk,
    quiz: quizPercent >= (R.minQuizPercent || 0),
  };
  const eligible = Object.values(checks).every(Boolean);

  const result = { eligible, checks, metrics: { coursePercent, attendancePercent, quizPercent }, issued: false };
  if (!eligible) return result;

  // ── idempotent issue ──
  const existing = await Certificate.findOne({
    student: rxEq(user.name || ''),
    course: rxEq(course.title || ''),
    status: { $in: ['Issued', 'Sent'] },
    removed: false,
  }).lean();
  if (existing) return { ...result, issued: false, certificateId: existing.certificateId, already: true };

  if (!R.autoIssue && !force) return { ...result, issued: false, reason: 'autoIssue off' };

  const certificateId = `CLC-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const now = new Date();
  const validUntil = R.validMonths ? new Date(now.getFullYear(), now.getMonth() + R.validMonths, now.getDate()) : undefined;
  const cert = await Certificate.create({
    student: user.name,
    course: course.title,
    batch: roster ? roster.batch : undefined,
    certificateId,
    title: R.title || 'Certificate of Completion',
    type: R.type || 'Completion',
    issuedOn: now,
    validUntil,
    grade: gradeFor(coursePercent),
    score: coursePercent,
    status: 'Issued',
    verificationUrl: crmBase() ? `${crmBase()}/#/verify/${certificateId}` : `/#/verify/${certificateId}`,
    issuedBy: opts.byName || 'System (auto)',
  });

  // best-effort email
  try {
    const mailer = require('./mailer');
    if (user.email && mailer.ready()) {
      await mailer.sendMail([user.email], {
        subject: `🎓 Certificate issued — ${course.title}`,
        html: `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:520px;margin:0 auto">
          <h2>Congratulations, ${escapeHtml(user.name)}!</h2>
          <p>You've earned a <b>${escapeHtml(R.title || 'Certificate of Completion')}</b> for <b>${escapeHtml(course.title)}</b>.</p>
          <p>Certificate ID: <b>${certificateId}</b><br/>Score: ${coursePercent}% · Grade ${gradeFor(coursePercent)}</p>
          <p><a href="${cert.verificationUrl}" style="color:#2f5fd0;font-weight:600">View / verify your certificate &rarr;</a></p>
        </div>`,
      });
      cert.status = 'Sent';
      await cert.save();
    }
  } catch (e) {
    /* non-fatal */
  }

  return { ...result, issued: true, certificateId };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// fire-and-forget helper for hooks
function evaluateSafe(crmUserId, courseId, opts) {
  Promise.resolve()
    .then(() => evaluate(crmUserId, courseId, opts))
    .catch((e) => console.error('[lms] certificateEngine:', e.message));
}

module.exports = { evaluate, evaluateSafe };
