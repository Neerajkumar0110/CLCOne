const mongoose = require('mongoose');
const { liveClassService, lmsConfig } = require('../../../services/lms');
const settingsService = require('../../../services/lms/settingsService');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES } = require('../../../config/roles');

// Role-scoped read APIs for live classes / recordings / attendance.
// Golden rule: course/batch/student ids from the client are NEVER trusted —
// every list is re-scoped from req.admin.

const isManager = (a) => MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role);

async function myEnrolments(admin) {
  return mongoose.model('LmsEnrolment').find({ crmUser: admin._id }).lean();
}
async function myMoodleCourseIds(admin) {
  const e = await myEnrolments(admin);
  return [...new Set(e.map((x) => x.moodleCourseId).filter(Boolean))];
}

/* ─────────────── STUDENT (self only) ─────────────── */

// GET /api/lms/student/live-classes?scope=
async function studentLiveClasses(req, res) {
  const rows = await liveClassService.listFor(req.admin, { scope: req.query.scope });
  return res.status(200).json({ success: true, result: rows.filter((r) => r.myRole === 'student' || isManager(req.admin)) });
}

// GET /api/lms/student/attendance?courseTitle=
async function studentAttendance(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const me = String(req.admin._id);
  const q = { removed: false, 'participants.crmUser': req.admin._id };
  if (req.query.courseTitle) q.courseTitle = req.query.courseTitle;
  if (req.query.batchName) q.batchName = req.query.batchName;
  const sessions = await LmsLiveSession.find(q).sort({ scheduledStart: 1 }).lean();

  const classes = [];
  let present = 0;
  let partial = 0;
  let absent = 0;
  let late = 0;
  let sumPct = 0;
  for (const s of sessions) {
    const p = (s.participants || []).find((x) => String(x.crmUser) === me);
    if (!p) continue;
    if (p.attendanceStatus === 'PRESENT') present += 1;
    else if (p.attendanceStatus === 'LATE') { present += 1; late += 1; }
    else if (p.attendanceStatus === 'PARTIAL') partial += 1;
    else absent += 1;
    sumPct += p.attendancePct || 0;
    classes.push({
      date: s.scheduledStart,
      className: s.title,
      courseTitle: s.courseTitle,
      batchName: s.batchName,
      scheduledDurationMin: s.scheduledDurationMin,
      attendedMin: p.totalDurationMin || 0,
      attendancePct: p.attendancePct || 0,
      status: p.attendanceStatus,
      joins: p.joinCount,
    });
  }
  const n = classes.length || 1;
  return res.status(200).json({
    success: true,
    result: {
      summary: {
        totalClasses: classes.length,
        present,
        partial,
        absent,
        late,
        attendancePct: Math.round(sumPct / n),
      },
      classes,
    },
  });
}

/* ─────────────── RECORDINGS (all roles, scoped) ─────────────── */

function recAccessFilter(admin) {
  // returns a mongo filter that limits which LiveRecording rows a user may see
  if (isManager(admin)) return {}; // admin: all
  return { $or: [{ teacherCrmUser: admin._id }, { teacherName: admin.name }, { __studentScoped: true }] };
}

async function listRecordings(req, res) {
  const LiveRecording = mongoose.model('LiveRecording');
  const admin = req.admin;
  const q = { removed: false };
  if (req.query.status) q.status = req.query.status;
  if (req.query.courseTitle) q.courseTitle = req.query.courseTitle;
  if (req.query.batchName) q.batchName = req.query.batchName;
  if (req.query.from || req.query.to) {
    q.publishedAt = {
      ...(req.query.from ? { $gte: new Date(req.query.from) } : {}),
      ...(req.query.to ? { $lte: new Date(req.query.to) } : {}),
    };
  }

  let rows = await LiveRecording.find(q).sort({ publishedAt: -1, created: -1 }).limit(500).lean();

  if (!isManager(admin)) {
    const s = await settingsService.get();
    const ownTaught = (r) =>
      String(r.teacherCrmUser) === String(admin._id) ||
      (r.teacherName || '').toLowerCase() === (admin.name || '').toLowerCase();

    const myCourseIds = await myMoodleCourseIds(admin);
    const myEnr = await myEnrolments(admin);
    const myBatchIds = new Set(myEnr.map((e) => String(e.batch)).filter(Boolean));
    const myCourseTitles = new Set();
    const LmsLiveSession = mongoose.model('LmsLiveSession');
    const linked = await LmsLiveSession.find({ moodleCourseId: { $in: myCourseIds } }, 'courseTitle batch').lean();
    linked.forEach((l) => l.courseTitle && myCourseTitles.add(l.courseTitle));
    const enrolledAccess = (r) => {
      if (r.status !== 'AVAILABLE') return false;
      if (s.recordingAccess === 'admin-only') return false;
      if (s.recordingAccess === 'batch') return myBatchIds.has(String(r.batch));
      return myCourseTitles.has(r.courseTitle);
    };
    rows = rows.filter((r) => ownTaught(r) || enrolledAccess(r));
  }

  return res.status(200).json({
    success: true,
    result: rows.map((r) => ({
      id: String(r._id),
      className: r.className,
      courseTitle: r.courseTitle,
      batchName: r.batchName,
      teacherName: r.teacherName,
      date: r.startedAt || r.created,
      durationMin: r.durationMin,
      status: r.status,
      provider: r.provider,
      views: r.views,
      publishedAt: r.publishedAt,
      canPlay: r.status === 'AVAILABLE',
    })),
  });
}

// GET /api/lms/recordings/:id/play  -> { url }  (access re-checked here)
async function playRecording(req, res) {
  const LiveRecording = mongoose.model('LiveRecording');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const admin = req.admin;
  const rec = await LiveRecording.findById(req.params.id).select('+playbackUrl +downloadUrl');
  if (!rec || rec.removed) return res.status(404).json({ success: false, message: 'Recording not found.' });
  if (rec.status !== 'AVAILABLE') return res.status(409).json({ success: false, message: `Recording is ${rec.status}.` });

  let allowed = isManager(admin);
  if (!allowed && (String(rec.teacherCrmUser) === String(admin._id) || (rec.teacherName || '').toLowerCase() === (admin.name || '').toLowerCase())) {
    allowed = true;
  }
  if (!allowed) {
    const s = await settingsService.get();
    if (s.recordingAccess !== 'admin-only') {
      const session = await LmsLiveSession.findById(rec.liveSession).lean();
      if (session) {
        const myCourseIds = await myMoodleCourseIds(admin);
        const enr = await mongoose.model('LmsEnrolment').findOne({ crmUser: admin._id, moodleCourseId: session.moodleCourseId });
        allowed = !!enr || (session.participants || []).some((p) => String(p.crmUser) === String(admin._id));
      }
    }
  }
  if (!allowed) return res.status(403).json({ success: false, message: 'You do not have access to this recording.' });

  await LiveRecording.updateOne({ _id: rec._id }, { $inc: { views: 1 }, $set: { lastViewedAt: new Date() } });
  return res.status(200).json({ success: true, result: { url: rec.playbackUrl || null, provider: rec.provider } });
}

// POST /api/lms/admin/recordings/:id/delete   (manager only — route guards)
async function deleteRecording(req, res) {
  const LiveRecording = mongoose.model('LiveRecording');
  const r = await LiveRecording.findByIdAndUpdate(
    req.params.id,
    { $set: { status: 'DELETED', updated: new Date() } },
    { new: true }
  );
  if (!r) return res.status(404).json({ success: false, message: 'Recording not found.' });
  // metadata is kept on purpose
  return res.status(200).json({ success: true, result: { id: String(r._id), status: r.status } });
}

/* ─────────────── ATTENDANCE DASHBOARD (teacher scoped / admin all) ─────────────── */

async function attendanceDashboard(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const admin = req.admin;
  const mgr = isManager(admin);

  const q = { removed: false };
  if (req.query.courseTitle) q.courseTitle = req.query.courseTitle;
  if (req.query.batchName) q.batchName = req.query.batchName;
  if (req.query.teacherName) q.teacherName = req.query.teacherName;
  if (req.query.classId) q._id = req.query.classId;
  if (req.query.from || req.query.to) {
    q.scheduledStart = {
      ...(req.query.from ? { $gte: new Date(req.query.from) } : {}),
      ...(req.query.to ? { $lte: new Date(req.query.to) } : {}),
    };
  }
  if (!mgr) {
    q.$or = [{ teacherCrmUser: admin._id }, { teacherName: admin.name }];
  }

  const sessions = await LmsLiveSession.find(q).sort({ scheduledStart: -1 }).limit(1000).lean();
  const studentQ = (req.query.student || '').toLowerCase();

  const rows = [];
  let present = 0;
  let partial = 0;
  let absent = 0;
  let late = 0;
  let durSum = 0;
  let pctSum = 0;
  let cnt = 0;
  const completedClasses = sessions.filter((s) => ['ended', 'recording_processing', 'recording_available'].includes(s.status)).length;

  for (const s of sessions) {
    for (const p of s.participants || []) {
      if (p.role !== 'student') continue;
      if (studentQ && !(`${p.name} ${p.email || ''}`.toLowerCase().includes(studentQ))) continue;
      if (req.query.status && p.attendanceStatus !== String(req.query.status).toUpperCase()) continue;
      cnt += 1;
      durSum += p.totalDurationMin || 0;
      pctSum += p.attendancePct || 0;
      if (p.attendanceStatus === 'PRESENT') present += 1;
      else if (p.attendanceStatus === 'LATE') { present += 1; late += 1; }
      else if (p.attendanceStatus === 'PARTIAL') partial += 1;
      else absent += 1;
      rows.push({
        studentName: p.name,
        email: p.email,
        batch: s.batchName,
        course: s.courseTitle,
        className: s.title,
        date: s.scheduledStart,
        scheduledDurationMin: s.scheduledDurationMin,
        joinTime: p.firstJoinAt,
        leaveTime: p.lastLeftAt,
        totalDurationMin: p.totalDurationMin || 0,
        attendancePct: p.attendancePct || 0,
        status: p.attendanceStatus,
        joins: p.joinCount,
        leaves: p.leaveCount,
      });
    }
  }

  const uniqueStudents = new Set(rows.map((r) => r.email || r.studentName)).size;
  return res.status(200).json({
    success: true,
    result: {
      kpis: {
        totalStudents: uniqueStudents,
        present,
        partial,
        absent,
        late,
        avgAttendancePct: cnt ? Math.round(pctSum / cnt) : 0,
        avgDurationMin: cnt ? Math.round(durSum / cnt) : 0,
        totalClasses: sessions.length,
        completedClasses,
      },
      rows: rows.slice(0, Number(req.query.limit) || 500),
    },
  });
}

// GET /api/lms/(admin|teacher)/attendance/export?format=csv
async function attendanceExport(req, res) {
  // reuse the dashboard aggregation
  const fakeRes = {
    _json: null,
    status() {
      return this;
    },
    json(x) {
      this._json = x;
      return this;
    },
  };
  await attendanceDashboard(req, fakeRes);
  const rows = (fakeRes._json && fakeRes._json.result && fakeRes._json.result.rows) || [];
  const format = (req.query.format || 'csv').toLowerCase();

  const headers = [
    'Student',
    'Email',
    'Batch',
    'Course',
    'Class',
    'Date',
    'Scheduled Min',
    'Join Time',
    'Leave Time',
    'Total Min',
    'Attendance %',
    'Status',
    'Joins',
    'Leaves',
  ];
  const line = (r) =>
    [
      r.studentName,
      r.email || '',
      r.batch || '',
      r.course || '',
      r.className || '',
      r.date ? new Date(r.date).toISOString() : '',
      r.scheduledDurationMin,
      r.joinTime ? new Date(r.joinTime).toISOString() : '',
      r.leaveTime ? new Date(r.leaveTime).toISOString() : '',
      r.totalDurationMin,
      r.attendancePct,
      r.status,
      r.joins,
      r.leaves,
    ]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',');

  if (format === 'xlsx') {
    try {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="attendance.xlsx"');
      return res.status(200).send(buf);
    } catch (e) {
      // fall through to csv
    }
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance.csv"`);
  return res.status(200).send([headers.join(','), ...rows.map(line)].join('\n'));
}

/* ─────────────── ADMIN monitoring + analytics ─────────────── */

async function liveMonitor(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const live = await LmsLiveSession.find({ removed: false, status: { $in: ['live', 'starting'] } })
    .sort({ actualStart: -1 })
    .lean();
  return res.status(200).json({
    success: true,
    result: live.map((s) => ({
      id: String(s._id),
      className: s.title,
      courseTitle: s.courseTitle,
      batchName: s.batchName,
      teacherName: s.teacherName,
      startedAt: s.actualStart,
      durationMin: s.actualStart ? Math.round((Date.now() - new Date(s.actualStart)) / 60000) : 0,
      studentsOnline: (s.participants || []).filter((p) => p.online && p.role === 'student').length,
      totalStudents: (s.participants || []).filter((p) => p.role === 'student').length,
      recordingStatus: s.recordingStatus,
      provider: s.meetingProvider,
    })),
  });
}

async function analytics(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LiveRecording = mongoose.model('LiveRecording');
  const [courses, batches, students, teachers, totalClasses, completed, recordings] = await Promise.all([
    mongoose.model('Course').countDocuments({ removed: false }),
    mongoose.model('Batch').countDocuments({ removed: false }),
    mongoose.model('Student').countDocuments({ removed: false }),
    mongoose.model('Admin').countDocuments({ removed: false }),
    LmsLiveSession.countDocuments({ removed: false }),
    LmsLiveSession.countDocuments({ removed: false, status: { $in: ['ended', 'recording_processing', 'recording_available'] } }),
    LiveRecording.countDocuments({ removed: false, status: 'AVAILABLE' }),
  ]);

  // attendance trend — last 30 days, avg % per day
  const since = new Date(Date.now() - 30 * 86400000);
  const recent = await LmsLiveSession.find({ removed: false, scheduledStart: { $gte: since } }, 'scheduledStart participants').lean();
  const byDay = {};
  for (const s of recent) {
    const d = new Date(s.scheduledStart).toISOString().slice(0, 10);
    const st = (s.participants || []).filter((p) => p.role === 'student');
    if (!st.length) continue;
    byDay[d] = byDay[d] || { sum: 0, n: 0 };
    st.forEach((p) => {
      byDay[d].sum += p.attendancePct || 0;
      byDay[d].n += 1;
    });
  }
  const trend = Object.entries(byDay)
    .sort()
    .map(([date, v]) => ({ date, avgAttendancePct: Math.round(v.sum / v.n) }));

  return res.status(200).json({
    success: true,
    result: {
      totals: { courses, batches, students, teachers, totalClasses, completedClasses: completed, recordings },
      attendanceTrend: trend,
    },
  });
}

/* ─────────────── settings ─────────────── */
async function getSettings(req, res) {
  return res.status(200).json({ success: true, result: await settingsService.get(true) });
}
async function updateSettings(req, res) {
  return res.status(200).json({ success: true, result: await settingsService.update(req.body || {}) });
}

module.exports = {
  studentLiveClasses,
  studentAttendance,
  listRecordings,
  playRecording,
  deleteRecording,
  attendanceDashboard,
  attendanceExport,
  liveMonitor,
  analytics,
  getSettings,
  updateSettings,
};
