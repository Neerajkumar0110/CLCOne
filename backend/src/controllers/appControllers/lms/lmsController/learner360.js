const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, LMS_TEACHER_ROLES } = require('../../../../config/roles');
const engine = require('../../../../services/lms/eligibilityEngine');

// Learner 360 Report (spec §16): "attendance + assessments + quizzes +
// surprise tests + project + curriculum + acknowledgements + eligibility"
// in one exportable view. Built on top of the eligibility engine (Phase 2)
// rather than re-deriving each metric — it already assembles every one of
// these per student; this just reshapes that + certificate status into a
// flat, exportable row per student.

const isManager = (a) => !!(a && MANAGEMENT_ROLES.includes(a.role));
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

async function assertOwnsCourse(admin, courseId) {
  const Course = mongoose.model('Course');
  if (!mongoose.isValidObjectId(courseId)) return null;
  const course = await Course.findOne({ _id: courseId, removed: false });
  if (!course) return null;
  if (isManager(admin)) return course;
  if (isTeacher(admin) && course.instructor && rxEq(course.instructor).test(admin.name || '')) return course;
  return null;
}

async function buildRows(course) {
  const Student = mongoose.model('Student');
  const Admin = mongoose.model('Admin');
  const Certificate = mongoose.model('Certificate');

  const roster = await Student.find({ course: rxEq(course.title), removed: false }).select('email name batch status').lean();
  const emails = [...new Set(roster.map((r) => (r.email || '').toLowerCase()).filter(Boolean))];
  const admins = emails.length ? await Admin.find({ email: { $in: emails.map(rxEq) }, removed: false }).select('_id name email').lean() : [];
  const rosterByEmail = Object.fromEntries(roster.map((r) => [(r.email || '').toLowerCase(), r]));

  const rows = [];
  for (const a of admins) {
    // eslint-disable-next-line no-await-in-loop
    const r = await engine.evaluate(a._id, course._id).catch(() => null);
    if (!r) continue;
    const rr = rosterByEmail[(a.email || '').toLowerCase()] || {};
    // eslint-disable-next-line no-await-in-loop
    const cert = await Certificate.findOne({
      student: rxEq(a.name || ''),
      course: rxEq(course.title),
      status: { $in: ['Issued', 'Sent'] },
      removed: false,
    }).select('certificateId issuedOn').lean();
    const byKey = Object.fromEntries(r.items.map((i) => [i.key, i]));

    rows.push({
      student: a.name,
      email: a.email,
      batch: rr.batch || '',
      enrollmentStatus: rr.status || '',
      attendancePct: byKey.attendance ? byKey.attendance.achieved : null,
      curriculumPct: byKey.curriculum ? byKey.curriculum.achieved : null,
      assignmentPct: byKey.assignment ? byKey.assignment.achieved : null,
      quizPct: byKey.quiz ? byKey.quiz.achieved : null,
      surpriseTestPct: byKey.surpriseTest ? byKey.surpriseTest.achieved : null,
      acknowledgementPct: byKey.acknowledgement ? byKey.acknowledgement.achieved : null,
      projectStatus: byKey.project ? byKey.project.detail || '' : 'n/a',
      eligibilityScore: r.score,
      eligibilityThreshold: r.threshold,
      eligibilityState: r.state,
      missing: r.missing.join('; '),
      certificateId: cert ? cert.certificateId : '',
      certificateIssuedOn: cert ? cert.issuedOn : '',
    });
  }
  return rows;
}

// GET /api/lms/admin/learner-360/:courseId
async function courseReport(req, res) {
  const course = await assertOwnsCourse(req.admin, req.params.courseId);
  if (!course) return res.status(403).json({ success: false, message: 'Not your course.' });
  const rows = await buildRows(course);
  return res.status(200).json({ success: true, result: { course: course.title, rows } });
}

// GET /api/lms/admin/learner-360/:courseId/export?format=csv|xlsx
async function courseReportExport(req, res) {
  const course = await assertOwnsCourse(req.admin, req.params.courseId);
  if (!course) return res.status(403).json({ success: false, message: 'Not your course.' });
  const rows = await buildRows(course);
  const format = (req.query.format || 'csv').toLowerCase();

  const headers = [
    'Student', 'Email', 'Batch', 'Enrollment Status',
    'Attendance %', 'Curriculum %', 'Assignments %', 'Quiz %', 'Surprise Test %', 'Acknowledgements %',
    'Project Status', 'Eligibility Score', 'Eligibility Threshold', 'Eligibility State', 'Missing',
    'Certificate ID', 'Certificate Issued',
  ];
  const line = (r) =>
    [
      r.student, r.email, r.batch, r.enrollmentStatus,
      r.attendancePct, r.curriculumPct, r.assignmentPct, r.quizPct, r.surpriseTestPct, r.acknowledgementPct,
      r.projectStatus, r.eligibilityScore, r.eligibilityThreshold, r.eligibilityState, r.missing,
      r.certificateId, r.certificateIssuedOn ? new Date(r.certificateIssuedOn).toISOString() : '',
    ]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',');

  if (format === 'xlsx') {
    try {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Learner 360');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="learner-360-${course.title}.xlsx"`);
      return res.status(200).send(buf);
    } catch (e) {
      // fall through to csv
    }
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="learner-360-${course.title}.csv"`);
  return res.status(200).send([headers.join(','), ...rows.map(line)].join('\n'));
}

module.exports = { courseReport, courseReportExport };
