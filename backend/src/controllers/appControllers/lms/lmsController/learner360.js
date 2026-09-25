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

// GET /api/lms/admin/learner-timeline/:crmUserId — manager only. Spec §13
// "Learner Management: view complete learner timeline" — previously nothing
// combined one learner's enrollment -> attendance -> payments -> corrections
// -> status-change history; courseReport above is course-wide-all-students
// metrics, not a single learner's chronological record.
async function learnerTimeline(req, res) {
  if (!isManager(req.admin)) return res.status(403).json({ success: false, message: 'Management role required.' });

  const Admin = mongoose.model('Admin');
  const Student = mongoose.model('Student');
  const PaymentRequest = mongoose.model('PaymentRequest');
  const AuditLog = mongoose.model('AuditLog');

  const learner = await Admin.findOne({ _id: req.params.crmUserId, removed: false }).lean();
  if (!learner) return res.status(404).json({ success: false, message: 'Learner not found.' });

  const [rosterRows, payments, statusChanges, attendanceCorrections] = await Promise.all([
    Student.find({ email: rxEq(learner.email) }).sort({ enrolledOn: 1 }).lean(),
    PaymentRequest.find({ studentEmail: rxEq(learner.email) }).sort({ created: 1 }).lean(),
    AuditLog.find({ module: 'student', action: 'status.change', entityId: learner._id }).sort({ created: 1 }).lean(),
    AuditLog.find({ module: 'attendance', action: 'correct', 'after.student': rxEq(learner.email) }).sort({ created: 1 }).lean(),
  ]);

  const events = [];
  rosterRows.forEach((r) =>
    events.push({
      at: r.enrolledOn || r.created,
      type: 'enrollment',
      summary: `Enrolled — ${r.course || 'course'}${r.batch ? ` (batch ${r.batch})` : ''}`,
      detail: { course: r.course, batch: r.batch, status: r.status },
    })
  );
  payments.forEach((p) =>
    events.push({
      at: p.created,
      type: 'payment',
      summary: `Payment ${p.status} — ₹${p.amount} (installment ${p.installmentNo}/${p.installmentCount})`,
      detail: { status: p.status, amount: p.amount, razorpayPaymentId: p.razorpayPaymentId },
    })
  );
  statusChanges.forEach((a) =>
    events.push({
      at: a.created,
      type: 'status-change',
      summary: `Status changed: ${a.after?.from || '?'} → ${a.after?.to || '?'}`,
      detail: { by: a.performedByName, from: a.after?.from, to: a.after?.to },
    })
  );
  attendanceCorrections.forEach((a) =>
    events.push({
      at: a.created,
      type: 'attendance-correction',
      summary: `Attendance corrected to ${a.after?.status || '?'} — ${a.reason || 'no reason given'}`,
      detail: { by: a.performedByName, before: a.before, after: a.after, reason: a.reason },
    })
  );

  events.sort((x, y) => new Date(x.at) - new Date(y.at));

  return res.status(200).json({
    success: true,
    result: {
      learner: { id: String(learner._id), name: learner.name, email: learner.email, rosterHold: !!learner.rosterHold, financeHold: !!learner.financeHold },
      currentStatus: rosterRows[rosterRows.length - 1]?.status || null,
      events,
    },
  });
}

module.exports = { courseReport, courseReportExport, learnerTimeline };
