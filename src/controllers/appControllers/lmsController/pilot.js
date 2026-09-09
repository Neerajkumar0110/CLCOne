const crypto = require('crypto');
const mongoose = require('mongoose');
const { getMoodleClient, lmsConfig, syncService, sso, roleMap, liveClassService } = require('../../../services/lms');

// ─────────────────────────────────────────────────────────────────────────────
// PILOT / INTERNAL TEST helpers — verify the whole LMS flow on the server
// before a public domain + BigBlueButton exist.
//
//   REAL  : CRM<->Moodle user/course/enrolment sync, SSO, event webhooks,
//           the live-class lifecycle + auto meeting room + attendance capture
//           (all via services/lms/liveClassService.js).
//   MOCK  : the meeting itself while the provider is 'mock' (CRM room page) or
//           'jitsi' (real public video, no per-role controls). Switches to
//           real BigBlueButton automatically once BBB_URL / BBB_SECRET are set.
//
// The live-class operations here just call liveClassService acting as the
// pilot teacher / student, so the pilot exercises the SAME code path as the
// real /api/lms/liveclasses/* endpoints.
// ─────────────────────────────────────────────────────────────────────────────

const PILOT_TAG = '[LMS-PILOT]';
const DEMO = {
  courseTitle: 'Demo Test Course',
  courseCode: 'DEMO-101',
  batchName: 'Demo Live Class Batch',
  classTopic: 'Demo Live Class',
  teacher: { name: 'Test Teacher', email: 'pilot.teacher@example.com', role: 'Team Leader' },
  student: { name: 'Test Student', email: 'pilot.student@example.com', role: 'Sales Intern' },
};

async function pilotUser(who) {
  const spec = who === 'teacher' ? DEMO.teacher : DEMO.student;
  return mongoose.model('Admin').findOne({ email: spec.email });
}

async function findOrCreateCrmUser(spec) {
  const Admin = mongoose.model('Admin');
  const AdminPassword = mongoose.model('AdminPassword');
  let user = await Admin.findOne({ email: spec.email.toLowerCase() });
  if (user) return user;
  user = await new Admin({
    name: spec.name,
    surname: '(pilot)',
    email: spec.email.toLowerCase(),
    role: spec.role,
    enabled: false, // cannot log into the CRM — acted on via API, tested via SSO into Moodle
  }).save();
  const salt = crypto.randomBytes(8).toString('hex');
  await new AdminPassword({
    password: require('bcryptjs').hashSync(salt + crypto.randomBytes(12).toString('hex')),
    salt,
    emailVerified: true,
    user: user._id,
  }).save();
  return user;
}

// POST /api/lms/admin/pilot/seed
async function seed(req, res) {
  const Course = mongoose.model('Course');
  const Batch = mongoose.model('Batch');
  const LmsLiveSession = mongoose.model('LmsLiveSession');

  const steps = [];
  const push = (k, v) => steps.push({ step: k, ...v });

  // 1. course
  let course = await Course.findOne({ title: DEMO.courseTitle, removed: false });
  if (!course) {
    course = await new Course({
      title: DEMO.courseTitle,
      code: DEMO.courseCode,
      category: 'Technical',
      level: 'Beginner',
      mode: 'Live',
      status: 'Published',
      instructor: DEMO.teacher.name,
      durationHours: 2,
      description: 'Pilot course to verify the end-to-end LMS flow (CRM <-> Moodle).',
    }).save();
  }
  push('course', { crmCourseId: String(course._id), title: course.title });

  // 2. teacher + student (CRM)
  const teacher = await findOrCreateCrmUser(DEMO.teacher);
  const student = await findOrCreateCrmUser(DEMO.student);
  push('teacher', { crmUserId: String(teacher._id), email: teacher.email });
  push('student', { crmUserId: String(student._id), email: student.email });

  const moodleUp = getMoodleClient().configured;
  let courseMap = null;
  let tMap = null;
  let sMap = null;

  if (moodleUp) {
    tMap = await syncService.provisionUser(teacher);
    sMap = await syncService.provisionUser(student);
    push('provision.teacher', { moodleUserId: tMap.moodleUserId, syncStatus: tMap.syncStatus });
    push('provision.student', { moodleUserId: sMap.moodleUserId, syncStatus: sMap.syncStatus });

    courseMap = await syncService.mirrorCourse(course);
    push('course.mirror', { moodleCourseId: courseMap.moodleId, syncStatus: courseMap.syncStatus });

    if (courseMap.moodleId) {
      const tEnr = await syncService.enrolUser({
        crmUserId: teacher._id,
        crmCourseId: course._id,
        moodleCourseId: courseMap.moodleId,
        roleShortname: 'editingteacher',
        source: 'admin',
      });
      const sEnr = await syncService.enrolUser({
        crmUserId: student._id,
        crmCourseId: course._id,
        moodleCourseId: courseMap.moodleId,
        roleShortname: 'student',
        source: 'admin',
      });
      push('enrol.teacher', { status: tEnr.status, syncStatus: tEnr.syncStatus });
      push('enrol.student', { status: sEnr.status, syncStatus: sEnr.syncStatus });
    }
  } else {
    push('moodle', { skipped: 'Moodle not configured — sync deferred. CRM-side demo still created.' });
  }

  // 3. batch — its post-save hook auto-creates the live class + meeting room
  let batch = await Batch.findOne({ name: DEMO.batchName, removed: false });
  if (!batch) {
    batch = await new Batch({
      name: DEMO.batchName,
      code: 'DEMO-B1',
      course: course.title,
      mode: 'Online',
      trainer: DEMO.teacher.name,
      status: 'Running',
      startDate: new Date(Date.now() + 60 * 60 * 1000),
      schedule: 'Morning 09:00',
      seats: 10,
      enrolled: 1,
      notes: `${PILOT_TAG}`,
    }).save();
  }
  // run the same path the hook runs, synchronously + idempotently
  await liveClassService.onBatchCreated(batch);
  const session = await LmsLiveSession.findOne({ batch: batch._id, removed: false }).sort({ created: -1 });
  push('liveClass', {
    sessionId: session ? String(session._id) : null,
    roomName: session ? session.roomName : null,
    meetingProvider: session ? session.meetingProvider : null,
  });

  return res.status(200).json({
    success: true,
    result: {
      note: 'Demo seeded. Next: POST /api/lms/liveclasses/<sessionId>/start  (or the pilot wrappers).',
      moodleConfigured: moodleUp,
      meetingProvider: lmsConfig.meeting.effectiveProvider,
      ids: {
        crmCourseId: String(course._id),
        moodleCourseId: courseMap ? courseMap.moodleId : null,
        teacherCrmId: String(teacher._id),
        teacherMoodleId: tMap ? tMap.moodleUserId : null,
        studentCrmId: String(student._id),
        studentMoodleId: sMap ? sMap.moodleUserId : null,
        batchId: String(batch._id),
        sessionId: session ? String(session._id) : null,
        roomName: session ? session.roomName : null,
      },
      steps,
    },
  });
}

// ── live-class wrappers (delegate to liveClassService as the pilot user) ────
async function liveStart(req, res) {
  const teacher = await pilotUser('teacher');
  if (!teacher) return res.status(404).json({ success: false, message: 'Run pilot/seed first.' });
  const out = await liveClassService.startSession(req.params.id, teacher);
  return res.status(out.error || 200).json({ success: !out.error, message: out.message, result: out.result });
}

async function liveJoin(req, res) {
  const who = (req.body && req.body.who) === 'teacher' ? 'teacher' : 'student';
  const u = await pilotUser(who);
  if (!u) return res.status(404).json({ success: false, message: 'Run pilot/seed first.' });
  const out = await liveClassService.issueJoin(req.params.id, u);
  return res.status(out.error || 200).json({
    success: !out.error,
    message: out.message,
    result: out.result ? { ...out.result, who } : undefined,
  });
}

async function liveLeave(req, res) {
  const who = (req.body && req.body.who) === 'teacher' ? 'teacher' : 'student';
  const u = await pilotUser(who);
  if (!u) return res.status(404).json({ success: false, message: 'Run pilot/seed first.' });
  const out = await liveClassService.recordLeave(req.params.id, u._id);
  return res.status(out.error || 200).json({ success: !out.error, message: out.message, result: out.result });
}

async function liveEnd(req, res) {
  const teacher = await pilotUser('teacher');
  if (!teacher) return res.status(404).json({ success: false, message: 'Run pilot/seed first.' });
  const out = await liveClassService.endSession(req.params.id, teacher);
  return res.status(out.error || 200).json({ success: !out.error, message: out.message, result: out.result });
}

// POST /api/lms/admin/pilot/sso-link  { who } | { crmUserId }
async function ssoLink(req, res) {
  if (!lmsConfig.isConfigured || !lmsConfig.sso.secret) {
    return res.status(503).json({ success: false, message: 'SSO not configured (MOODLE_WS_URL / MOODLE_SSO_SECRET).' });
  }
  const Admin = mongoose.model('Admin');
  let crmUserId = req.body && req.body.crmUserId;
  if (!crmUserId && req.body && req.body.who) {
    const u = await pilotUser(req.body.who);
    crmUserId = u && u._id;
  }
  const user = await Admin.findById(crmUserId);
  if (!user) return res.status(404).json({ success: false, message: 'CRM user not found.' });

  const token = sso.mintLoginToken({
    crmUserId: user._id,
    email: user.email,
    name: `${user.name} ${user.surname || ''}`.trim(),
    lmsRole: roleMap.lmsRoleForCrm(user.role),
    wantsurl: typeof (req.body && req.body.wantsurl) === 'string' ? req.body.wantsurl : '/my/',
  });
  return res.status(200).json({
    success: true,
    result: { user: user.name, url: sso.buildLoginUrl(token), expiresInSec: lmsConfig.sso.tokenTtlSec },
  });
}

// GET /api/lms/admin/pilot/status/:sessionId
async function pilotStatus(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  const MoodleObjectMap = mongoose.model('MoodleObjectMap');
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const AttendanceRecord = mongoose.model('AttendanceRecord');
  const LmsWebhookEvent = mongoose.model('LmsWebhookEvent');
  const Admin = mongoose.model('Admin');

  const session = await LmsLiveSession.findById(req.params.sessionId).lean();
  if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });

  const [teacher, student] = await Promise.all([
    Admin.findOne({ email: DEMO.teacher.email }).lean(),
    Admin.findOne({ email: DEMO.student.email }).lean(),
  ]);
  const ids = [teacher, student].filter(Boolean).map((u) => u._id);
  const [userMaps, courseMap, enrolments, attendance, events] = await Promise.all([
    MoodleUserMap.find({ crmUser: { $in: ids } }).lean(),
    MoodleObjectMap.findOne({ kind: 'course', crmId: session.crmCourse }).lean(),
    LmsEnrolment.find({ crmUser: { $in: ids } }).lean(),
    AttendanceRecord.find({ sessionTopic: session.title, removed: false }).sort({ date: -1 }).lean(),
    LmsWebhookEvent.find({}).sort({ receivedAt: -1 }).limit(5).lean(),
  ]);
  const client = getMoodleClient();

  return res.status(200).json({
    success: true,
    result: {
      moodle: { configured: client.configured, breakerOpen: client._breakerOpen ? client._breakerOpen() : false },
      liveSession: {
        id: String(session._id),
        status: session.status, // upcoming | live | ended
        meetingProvider: session.meetingProvider,
        isMock: session.isMock,
        roomName: session.roomName,
        scheduledStart: session.scheduledStart,
        actualStart: session.actualStart,
        actualEnd: session.actualEnd,
        recording: { enabled: session.recordingEnabled, status: session.recordingStatus },
        participants: (session.participants || []).map((p) => ({
          name: p.name,
          role: p.role,
          joinedAt: p.firstJoinAt,
          leftAt: p.lastLeftAt,
          durationMin: p.totalDurationMin,
          attendancePct: p.attendancePct,
          attendanceStatus: p.attendanceStatus,
        })),
      },
      mapping: {
        course: courseMap ? { crmId: String(courseMap.crmId), moodleId: courseMap.moodleId, syncStatus: courseMap.syncStatus } : null,
        users: userMaps.map((m) => ({ email: m.email, moodleUserId: m.moodleUserId, lmsRole: m.lmsRole, syncStatus: m.syncStatus })),
      },
      enrolments: enrolments.map((e) => ({
        crmUser: String(e.crmUser),
        moodleCourseId: e.moodleCourseId,
        role: e.roleShortname,
        status: e.status,
        syncStatus: e.syncStatus,
        progressPct: e.progressPct,
        completedOn: e.completedOn,
      })),
      attendance: attendance.map((a) => ({ student: a.student, status: a.status, durationMin: a.durationMin, date: a.date })),
      recentWebhookEvents: events.map((ev) => ({ eventName: ev.eventName, status: ev.status, receivedAt: ev.receivedAt })),
    },
  });
}

// POST /api/lms/admin/pilot/teardown
async function teardown(req, res) {
  const Admin = mongoose.model('Admin');
  const Course = mongoose.model('Course');
  const Batch = mongoose.model('Batch');
  const LiveClass = mongoose.model('LiveClass');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const AttendanceRecord = mongoose.model('AttendanceRecord');

  const [teacher, student] = await Promise.all([
    Admin.findOne({ email: DEMO.teacher.email }),
    Admin.findOne({ email: DEMO.student.email }),
  ]);
  const course = await Course.findOne({ title: DEMO.courseTitle });

  for (const u of [teacher, student].filter(Boolean)) {
    if (course) {
      const cm = await mongoose.model('MoodleObjectMap').findOne({ kind: 'course', crmId: course._id });
      if (cm && cm.moodleId) await syncService.unenrolUser({ crmUserId: u._id, moodleCourseId: cm.moodleId }).catch(() => {});
    }
    await syncService.suspendUser(u._id).catch(() => {});
  }

  const soft = { $set: { removed: true, updated: new Date() } };
  await Promise.all([
    course ? Course.updateOne({ _id: course._id }, soft) : null,
    Batch.updateMany({ name: DEMO.batchName }, soft),
    LiveClass.updateMany({ topic: new RegExp(DEMO.batchName) }, soft),
    LmsLiveSession.updateMany({ batchName: DEMO.batchName }, { $set: { status: 'cancelled', removed: true } }),
    AttendanceRecord.updateMany({ course: DEMO.courseTitle }, soft),
    teacher ? LmsEnrolment.updateMany({ crmUser: teacher._id }, { $set: { status: 'ended' } }) : null,
    student ? LmsEnrolment.updateMany({ crmUser: student._id }, { $set: { status: 'ended' } }) : null,
  ]);

  return res.status(200).json({
    success: true,
    result: { note: 'Demo soft-removed; Moodle pilot users suspended + unenrolled. Disabled CRM Admin rows kept.' },
  });
}

module.exports = { seed, liveStart, liveJoin, liveLeave, liveEnd, ssoLink, pilotStatus, teardown, DEMO };
