const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES, LMS_TEACHER_ROLES } = require('../../../config/roles');
const { istDateTime } = require('../../../services/lms/recurrence');

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
// "Today" means today in India, regardless of what timezone the server
// process itself happens to be in — see recurrence.js's istDateTime for why
// a fixed +5:30 offset is used instead of Date's local-time methods.
const startOfDay = (d = new Date()) => istDateTime(d, 0, 0);
const endOfDay = (d = new Date()) => new Date(istDateTime(d, 23, 59).getTime() + 59999);
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

  const isMgr = isManager(admin);
  const courseFilter = isMgr
    ? { removed: false }
    : {
        removed: false,
        $or: [
          { instructor: rx(teacherName) },
          { instructor: { $exists: false } },
          { instructor: '' },
          { instructor: null },
        ],
      };

  const [courses, batches] = await Promise.all([
    Course.find(courseFilter).lean(),
    Batch.find({ removed: false, trainer: rx(teacherName) }).lean(),
  ]);

  // A session's teacherName/teacherCrmUser is a snapshot taken once at
  // batch-creation time (services/lms/recurrence.js) and never refreshed if
  // the batch's Trainer is edited afterward — matching on the batch's
  // CURRENT trainer too (already fetched above) keeps this self-healing
  // instead of leaving classes invisible until the sessions are recreated.
  const sessions = await LmsLiveSession.find({
    removed: false,
    $or: [{ teacherCrmUser: admin._id }, { teacherName: rx(teacherName) }, { batch: { $in: batches.map((b) => b._id) } }],
  })
    .select('status scheduledStart scheduledEnd scheduledDurationMin actualStart actualEnd participants title courseTitle batchName recordingStatus')
    .lean();

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
      courses: courses.slice(0, 20).map((c) => ({
        id: String(c._id),
        title: c.title,
        status: c.status,
        enrolled: c.enrolledCount || 0,
        thumbnailUrl: c.thumbnailUrl || '/course-thumbnail.jpg',
        category: c.category || 'Certification',
        level: c.level || 'Beginner',
        mode: c.mode || 'Live',
        durationHours: c.durationHours || 0,
        modules: c.modules || 0,
        lessons: c.lessons || 0,
        code: c.code || '',
        description: c.description || '',
      })),
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

// GET /api/lms/my/updates — lightweight poll for the panel: unread LMS
// notifications + what's live right now (for the sidebar "LIVE NOW" pill).
async function myUpdates(req, res) {
  const admin = req.admin;
  const Notification = mongoose.model('Notification');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const Student = mongoose.model('Student');

  const [unread, recent] = await Promise.all([
    Notification.countDocuments({ recipient: admin._id, module: 'LMS', readAt: null, removed: false }),
    Notification.find({ recipient: admin._id, module: 'LMS', removed: false }).sort({ created: -1 }).limit(12).lean(),
  ]);

  let liveQuery = null;
  if (isManager(admin) || LMS_TEACHER_ROLES?.includes?.(admin.role)) {
    liveQuery = { status: { $in: ['live', 'starting'] }, $or: [{ teacherCrmUser: admin._id }, { teacherName: rx(admin.name) }] };
  } else {
    const rows = await Student.find({ removed: false, email: rx(admin.email || '') }).select('batch').lean();
    const batches = [...new Set(rows.map((r) => r.batch).filter(Boolean))];
    liveQuery = batches.length ? { status: { $in: ['live', 'starting'] }, batchName: { $in: batches } } : null;
  }
  const live = liveQuery
    ? await LmsLiveSession.find({ removed: false, ...liveQuery }).select('title courseTitle batchName status').limit(10).lean()
    : [];

  return res.status(200).json({
    success: true,
    result: {
      unread,
      notifications: recent.map((n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body, link: n.link, at: n.created, read: !!n.readAt })),
      liveNow: live.map((s) => ({ id: String(s._id), title: s.title, course: s.courseTitle, batch: s.batchName })),
    },
  });
}

// GET /api/lms/teacher/live-analytics — the spec's "LIVE CLASS ANALYTICS".
async function teacherLiveAnalytics(req, res) {
  const admin = req.admin;
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LiveRecording = mongoose.model('LiveRecording');
  const teacherName = isManager(admin) && req.query.teacher ? String(req.query.teacher) : admin.name;

  const [sessions, recordings] = await Promise.all([
    LmsLiveSession.find({ removed: false, $or: [{ teacherCrmUser: admin._id }, { teacherName: rx(teacherName) }] })
      .select('status scheduledStart scheduledDurationMin actualStart actualEnd participants title courseTitle batchName').lean(),
    LiveRecording.find({ removed: false, $or: [{ teacherCrmUser: admin._id }, { teacherName: rx(teacherName) }] })
      .select('views durationMin className').lean(),
  ]);

  const ended = sessions.filter((s) => ['ended', 'recording_processing', 'recording_available'].includes(s.status));
  let liveMin = 0;
  let joinDelaySum = 0;
  let joinDelayN = 0;
  let durSum = 0;
  let partTotal = 0;
  const perStudent = {};

  for (const s of ended) {
    const start = s.actualStart ? new Date(s.actualStart) : s.scheduledStart ? new Date(s.scheduledStart) : null;
    const dur = s.actualStart && s.actualEnd ? Math.max(0, Math.round((new Date(s.actualEnd) - new Date(s.actualStart)) / 60000)) : (s.scheduledDurationMin || 60);
    liveMin += dur;
    durSum += dur;
    for (const p of s.participants || []) {
      partTotal += 1;
      const key = p.email || p.name || String(p.crmUser || 'x');
      perStudent[key] = perStudent[key] || { name: p.name, email: p.email, attended: 0, missed: 0, durationSum: 0, pctSum: 0, n: 0, last: null };
      const ps = perStudent[key];
      ps.n += 1;
      ps.attended += 1;
      ps.durationSum += p.totalDurationMin || 0;
      ps.pctSum += p.attendancePct || 0;
      if (!ps.last || (s.scheduledStart && new Date(s.scheduledStart) > new Date(ps.last))) ps.last = s.scheduledStart;
      if (start && p.firstJoinAt) {
        joinDelaySum += Math.max(0, Math.round((new Date(p.firstJoinAt) - start) / 60000));
        joinDelayN += 1;
      }
    }
  }

  const totalClasses = sessions.length;
  const recViews = recordings.reduce((a, r) => a + (r.views || 0), 0);
  const recMinutes = recordings.reduce((a, r) => a + (r.durationMin || 0), 0);

  return res.status(200).json({
    success: true,
    result: {
      totals: {
        totalClasses,
        completedClasses: ended.length,
        totalLiveHours: Math.round((liveMin / 60) * 10) / 10,
        avgAttendancePct: partTotal ? Math.round(ended.reduce((a, s) => a + (s.participants || []).reduce((x, p) => x + (p.attendancePct || 0), 0), 0) / partTotal) : 0,
        avgJoinDelayMin: joinDelayN ? Math.round(joinDelaySum / joinDelayN) : 0,
        avgDurationMin: ended.length ? Math.round(durSum / ended.length) : 0,
        totalParticipants: partTotal,
        recordingViews: recViews,
        recordingMinutesAvailable: recMinutes,
      },
      perStudent: Object.values(perStudent)
        .map((ps) => ({
          name: ps.name,
          email: ps.email,
          classesAttended: ps.attended,
          classesMissed: Math.max(0, ended.length - ps.attended),
          attendancePct: ps.n ? Math.round(ps.pctSum / ps.n) : 0,
          avgDurationMin: ps.n ? Math.round(ps.durationSum / ps.n) : 0,
          lastClassAt: ps.last,
        }))
        .sort((a, b) => b.classesAttended - a.classesAttended)
        .slice(0, 100),
      byClass: ended.slice(-15).map((s) => ({
        title: s.title,
        course: s.courseTitle,
        date: s.scheduledStart,
        present: (s.participants || []).filter((p) => ['PRESENT', 'LATE'].includes(p.attendanceStatus)).length,
        total: (s.participants || []).length,
      })),
    },
  });
}

module.exports = { teacherDashboard, studentDashboard, myUpdates, teacherLiveAnalytics };
