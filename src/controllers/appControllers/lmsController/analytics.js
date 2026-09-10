const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES } = require('../../../config/roles');

// GET /api/lms/teacher/analytics?course=
// Aggregates across the teacher's courses/students and builds the cohorts the
// spec asks for (high performers / slow learners / inactive / at-risk / low
// attendance / pending assignments).

const isManager = (a) => !!(a && (MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role)));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const avg = (arr, f) => (arr.length ? Math.round(arr.reduce((a, b) => a + (f(b) || 0), 0) / arr.length) : 0);

async function teacherAnalytics(req, res) {
  const admin = req.admin;
  const Course = mongoose.model('Course');
  const Batch = mongoose.model('Batch');
  const Student = mongoose.model('Student');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const Assignment = mongoose.model('Assignment');
  const AssignmentSubmission = mongoose.model('AssignmentSubmission');
  const QuizAttempt = mongoose.model('QuizAttempt');

  const teacherName = isManager(admin) && req.query.teacher ? String(req.query.teacher) : admin.name;

  const [courses, batches] = await Promise.all([
    Course.find({ removed: false, instructor: rxEq(teacherName) }).lean(),
    Batch.find({ removed: false, trainer: rxEq(teacherName) }).lean(),
  ]);
  const courseTitles = courses.map((c) => c.title);
  const courseIds = courses.map((c) => c._id);
  const batchNames = batches.map((b) => b.name);

  const students = batchNames.length
    ? await Student.find({ removed: false, batch: { $in: batchNames } }).select('name email status progress attendancePct avgScore course batch updated').lean()
    : [];

  // pending assignment grading per student (published assignments they've submitted but not evaluated)
  const [assignments, subs, quizAtts, sessions] = await Promise.all([
    Assignment.find({ removed: false, course: { $in: courseIds } }).select('_id course published').lean(),
    AssignmentSubmission.find({ course: { $in: courseIds }, removed: { $ne: true } }).select('student status').lean(),
    QuizAttempt.find({ course: { $in: courseIds }, status: { $ne: 'in_progress' } }).select('student percent passed').lean(),
    LmsLiveSession.find({ removed: false, $or: [{ teacherCrmUser: admin._id }, { teacherName: rxEq(teacherName) }] })
      .select('status participants scheduledDurationMin actualStart actualEnd').lean(),
  ]);

  const submittedByStudent = {};
  subs.forEach((s) => {
    const k = String(s.student);
    submittedByStudent[k] = submittedByStudent[k] || { submitted: 0, evaluated: 0, pending: 0 };
    if (s.status === 'evaluated') submittedByStudent[k].evaluated += 1;
    else submittedByStudent[k].submitted += 1;
  });

  const quizByStudent = {};
  quizAtts.forEach((a) => {
    const k = String(a.student);
    quizByStudent[k] = quizByStudent[k] || { count: 0, sum: 0, passes: 0 };
    quizByStudent[k].count += 1;
    quizByStudent[k].sum += a.percent || 0;
    if (a.passed) quizByStudent[k].passes += 1;
  });

  const now = Date.now();
  const days30 = 30 * 24 * 3600 * 1000;
  const row = (s) => {
    const key = null; // roster rows aren't keyed to Admin _id; use email→best-effort below
    return {
      name: s.name,
      email: s.email,
      course: s.course,
      batch: s.batch,
      status: s.status,
      progress: s.progress || 0,
      attendancePct: s.attendancePct || 0,
      avgScore: s.avgScore || 0,
      lastActivity: s.updated,
    };
  };
  const rows = students.map(row);

  // cohorts
  const highPerformers = rows.filter((r) => r.progress >= 80 && r.avgScore >= 75).slice(0, 25);
  const slowLearners = rows.filter((r) => r.progress > 0 && r.progress < 40).slice(0, 25);
  const inactiveStudents = rows.filter((r) => !r.lastActivity || now - new Date(r.lastActivity).getTime() > days30).slice(0, 25);
  const lowAttendance = rows.filter((r) => r.attendancePct > 0 && r.attendancePct < 60).slice(0, 25);
  const atRiskStudents = rows.filter((r) => r.progress < 30 || r.attendancePct < 50 || (r.avgScore > 0 && r.avgScore < 40)).slice(0, 25);
  const pendingAssignments = rows.filter((r) => r.status === 'Active' && r.progress < 100).slice(0, 25); // proxy

  // charts
  const bucket = (getVal) => {
    const b = { '0-25': 0, '26-50': 0, '51-75': 0, '76-99': 0, '100': 0 };
    rows.forEach((r) => {
      const v = getVal(r);
      if (v >= 100) b['100'] += 1;
      else if (v >= 76) b['76-99'] += 1;
      else if (v >= 51) b['51-75'] += 1;
      else if (v >= 26) b['26-50'] += 1;
      else b['0-25'] += 1;
    });
    return Object.entries(b).map(([range, n]) => ({ range, count: n }));
  };

  const ended = sessions.filter((s) => ['ended', 'recording_processing', 'recording_available'].includes(s.status));
  let liveMin = 0;
  ended.forEach((s) => {
    liveMin += s.actualStart && s.actualEnd ? Math.max(0, Math.round((new Date(s.actualEnd) - new Date(s.actualStart)) / 60000)) : (s.scheduledDurationMin || 60);
  });

  return res.status(200).json({
    success: true,
    result: {
      scope: { teacher: teacherName, courses: courseTitles.length, batches: batchNames.length, students: rows.length },
      kpis: {
        avgCourseCompletion: avg(rows, (r) => r.progress),
        avgAttendance: avg(rows.filter((r) => r.attendancePct), (r) => r.attendancePct),
        avgQuizScore: avg(rows.filter((r) => r.avgScore), (r) => r.avgScore),
        activeStudents: rows.filter((r) => r.status === 'Active').length,
        completedStudents: rows.filter((r) => r.progress >= 100).length,
        totalLiveHours: Math.round((liveMin / 60) * 10) / 10,
        totalClasses: sessions.length,
        completedClasses: ended.length,
        assignmentsToGrade: subs.filter((s) => s.status !== 'evaluated').length,
      },
      charts: {
        courseCompletion: bucket((r) => r.progress),
        attendance: bucket((r) => r.attendancePct),
        quizScores: bucket((r) => r.avgScore),
        attendanceByClass: ended.slice(-10).map((s) => ({
          present: (s.participants || []).filter((p) => ['PRESENT', 'LATE'].includes(p.attendanceStatus)).length,
          total: (s.participants || []).length,
        })),
      },
      cohorts: { highPerformers, slowLearners, inactiveStudents, atRiskStudents, lowAttendance, pendingAssignments },
    },
  });
}

module.exports = { teacherAnalytics };
