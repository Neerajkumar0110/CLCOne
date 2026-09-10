const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES } = require('../../../config/roles');

// Dashboards for the two dedicated LMS panels:
//   GET /api/lms/teacher/dashboard   (role: Teacher, or a manager)
//   GET /api/lms/student/dashboard   (role: Student, or a manager impersonating
//                                     via ?studentEmail=)
//
// Everything is real data aggregated from the existing models (Course, Batch,
// Student, LmsLiveSession, LiveRecording, LmsEnrolment, Certificate). Features
// whose models don't exist yet (assignments, quizzes, doubts) report 0 with a
// `pending` flag so the UI can show "coming soon" instead of a broken number.

const isManager = (a) => !!(a && (MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role)));
const rx = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

async function teacherDashboard(req, res) {
  const admin = req.admin;
  const Course = mongoose.model('Course');
  const Batch = mongoose.model('Batch');
  const Student = mongoose.model('Student');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LiveRecording = mongoose.model('LiveRecording');

  // a manager may look at any teacher via ?teacher=<name>; a Teacher only sees self
  const teacherName = isManager(admin) && req.query.teacher ? String(req.query.teacher) : admin.name;

  const [courses, batches, sessions] = await Promise.all([
    Course.find({ removed: false, instructor: rx(teacherName) }).lean(),
    Batch.find({ removed: false, trainer: rx(teacherName) }).lean(),
    LmsLiveSession.find({
      removed: false,
      $or: [{ teacherCrmUser: admin._id }, { teacherName: rx(teacherName) }],
    })
      .select('status scheduledStart scheduledEnd scheduledDurationMin actualStart actualEnd participants title courseTitle batchName recordingStatus')
      .lean(),
  ]);

  const batchNames = batches.map((b) => b.name);
  const students = batchNames.length
    ? await Student.find({ removed: false, batch: { $in: batchNames } }).select('name email status progress attendancePct course batch').lean()
    : [];

  const now = new Date();
  const today0 = startOfDay(now);
  const today1 = endOfDay(now);

  const byStatus = (s) => sessions.filter((x) => x.status === s);
  const todays = sessions.filter((x) => x.scheduledStart && new Date(x.scheduledStart) >= today0 && new Date(x.scheduledStart) <= today1);
  const upcoming = sessions
    .filter((x) => ['scheduled', 'upcoming'].includes(x.status) && x.scheduledStart && new Date(x.scheduledStart) > now)
    .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
  const ended = sessions.filter((x) => ['ended', 'recording_processing', 'recording_available'].includes(x.status));

  // attendance average across this teacher's finished classes
  let attSum = 0;
  let attCount = 0;
  let liveMinutes = 0;
  for (const s of ended) {
    if (s.actualStart && s.actualEnd) liveMinutes += Math.max(0, Math.round((new Date(s.actualEnd) - new Date(s.actualStart)) / 60000));
    else liveMinutes += s.scheduledDurationMin || 60;
    for (const p of s.participants || []) {
      if (typeof p.attendancePct === 'number') { attSum += p.attendancePct; attCount += 1; }
    }
  }

  const recordings = await LiveRecording.countDocuments({
    removed: false,
    $or: [{ teacherCrmUser: admin._id }, { teacherName: rx(teacherName) }],
  });

  const activeStudents = students.filter((s) => s.status === 'Active').length;
  const avgCompletion = students.length ? Math.round(students.reduce((a, s) => a + (s.progress || 0), 0) / students.length) : 0;

  return res.status(200).json({
    success: true,
    result: {
      teacher: { name: teacherName, id: String(admin._id) },
      kpis: {
        totalCourses: courses.length,
        publishedCourses: courses.filter((c) => c.status === 'Published').length,
        draftCourses: courses.filter((c) => c.status === 'Draft').length,
        archivedCourses: courses.filter((c) => c.status === 'Archived').length,
        totalStudents: students.length,
        activeStudents,
        inactiveStudents: students.length - activeStudents,
        todaysClasses: todays.length,
        liveClasses: byStatus('live').length + byStatus('starting').length,
        upcomingClasses: upcoming.length,
        completedClasses: ended.length,
        totalLiveClassHours: Math.round((liveMinutes / 60) * 10) / 10,
        totalRecordings: recordings,
        avgAttendance: attCount ? Math.round(attSum / attCount) : 0,
        avgCourseCompletion: avgCompletion,
        pendingAssignments: 0, // model lands in a later phase
        pendingDoubts: 0,      // model lands in a later phase
        _pending: ['pendingAssignments', 'pendingDoubts'],
      },
      todaysClasses: todays.slice(0, 10).map(view),
      upcomingClasses: upcoming.slice(0, 10).map(view),
      atRiskStudents: students
        .filter((s) => (s.attendancePct || 0) < 50 || (s.progress || 0) < 25)
        .slice(0, 10)
        .map((s) => ({ name: s.name, email: s.email, course: s.course, batch: s.batch, attendancePct: s.attendancePct || 0, progress: s.progress || 0 })),
      courses: courses.slice(0, 20).map((c) => ({ id: String(c._id), title: c.title, status: c.status, enrolled: c.enrolledCount || 0 })),
      charts: {
        attendanceByClass: ended.slice(-8).map((s) => ({
          name: s.title || s.courseTitle || 'Class',
          present: (s.participants || []).filter((p) => ['PRESENT', 'LATE'].includes(p.attendanceStatus)).length,
          total: (s.participants || []).length,
        })),
        studentProgress: students.slice(0, 12).map((s) => ({ name: s.name, progress: s.progress || 0 })),
      },
    },
  });
}

function view(s) {
  return {
    id: String(s._id),
    title: s.title,
    course: s.courseTitle,
    batch: s.batchName,
    scheduledStart: s.scheduledStart,
    scheduledEnd: s.scheduledEnd,
    status: s.status,
    participants: (s.participants || []).length,
  };
}

async function studentDashboard(req, res) {
  const admin = req.admin;
  const Student = mongoose.model('Student');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LiveRecording = mongoose.model('LiveRecording');
  const Certificate = mongoose.model('Certificate');

  const email = (isManager(admin) && req.query.studentEmail ? req.query.studentEmail : admin.email || '').toLowerCase();
  const roster = email
    ? await Student.find({ removed: false, email: rx(email) }).select('name email course batch status progress attendancePct avgScore').lean()
    : [];

  const batchNames = [...new Set(roster.map((r) => r.batch).filter(Boolean))];
  const courseNames = [...new Set(roster.map((r) => r.course).filter(Boolean))];

  const now = new Date();
  const sessions = batchNames.length
    ? await LmsLiveSession.find({ removed: false, batchName: { $in: batchNames } })
        .select('status scheduledStart scheduledEnd title courseTitle batchName recordingStatus')
        .sort({ scheduledStart: 1 })
        .lean()
    : [];

  const todays = sessions.filter(
    (x) => x.scheduledStart && new Date(x.scheduledStart) >= startOfDay(now) && new Date(x.scheduledStart) <= endOfDay(now)
  );
  const upcoming = sessions.filter((x) => x.scheduledStart && new Date(x.scheduledStart) > now && ['scheduled', 'upcoming', 'live', 'starting'].includes(x.status));
  const liveNow = sessions.filter((x) => ['live', 'starting'].includes(x.status));

  const recordings = courseNames.length
    ? await LiveRecording.find({ removed: false, status: 'AVAILABLE', courseTitle: { $in: courseNames } })
        .select('className courseTitle batchName durationMin publishedAt')
        .sort({ publishedAt: -1 })
        .limit(10)
        .lean()
    : [];

  const certs = roster.length
    ? await Certificate.find({ removed: false, student: { $in: roster.map((r) => rx(r.name)) } })
        .select('course title status certificateId issuedOn verificationUrl')
        .lean()
    : [];

  const avgProgress = roster.length ? Math.round(roster.reduce((a, r) => a + (r.progress || 0), 0) / roster.length) : 0;
  const avgAttendance = roster.length ? Math.round(roster.reduce((a, r) => a + (r.attendancePct || 0), 0) / roster.length) : 0;

  return res.status(200).json({
    success: true,
    result: {
      student: { name: (roster[0] && roster[0].name) || admin.name, email },
      kpis: {
        enrolledCourses: courseNames.length,
        courseProgress: avgProgress,
        attendancePct: avgAttendance,
        todaysClasses: todays.length,
        upcomingClasses: upcoming.length,
        liveNow: liveNow.length,
        latestRecordings: recordings.length,
        certificates: certs.filter((c) => ['Issued', 'Sent'].includes(c.status)).length,
        pendingAssignments: 0,
        upcomingQuizzes: 0,
        _pending: ['pendingAssignments', 'upcomingQuizzes'],
      },
      courses: roster.map((r) => ({
        course: r.course,
        batch: r.batch,
        status: r.status,
        progress: r.progress || 0,
        attendancePct: r.attendancePct || 0,
        avgScore: r.avgScore || 0,
      })),
      todaysClasses: todays.slice(0, 10).map(view),
      upcomingClasses: upcoming.slice(0, 10).map(view),
      liveNow: liveNow.map(view),
      recordings: recordings.map((r) => ({
        className: r.className,
        course: r.courseTitle,
        batch: r.batchName,
        durationMin: r.durationMin,
        publishedAt: r.publishedAt,
      })),
      certificates: certs.map((c) => ({
        course: c.course,
        title: c.title,
        status: c.status,
        certificateId: c.certificateId,
        issuedOn: c.issuedOn,
        verificationUrl: c.verificationUrl,
      })),
    },
  });
}

module.exports = { teacherDashboard, studentDashboard };
