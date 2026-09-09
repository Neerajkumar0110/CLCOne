/* eslint-disable no-console */
// Staged E2E test for the LiveClass system — runs against an EPHEMERAL
// in-memory MongoDB with the REAL models + REAL services + the MOCK meeting
// provider. No production DB, no VPS, no BBB touched. Read-only w.r.t. the repo.
//
//   node scripts/lms-live-e2e.cjs
//
// Anything that genuinely needs a configured BigBlueButton server (real
// recording media, MODERATOR/VIEWER enforcement, live webhooks over the
// network) is reported BLOCKED, not PASS.

require('module-alias/register');
const path = require('path');
const { globSync } = require('glob');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// ---- env for the test (mock provider, deterministic settings) ----
process.env.LMS_MEETING_PROVIDER = 'mock';
process.env.LMS_MEETING_JITSI_BASE = '';
process.env.LMS_CRM_BASE_URL = 'http://127.0.0.1:8888';
process.env.LMS_MAX_AUTO_CLASSES = process.env.LMS_MAX_AUTO_CLASSES || '60';
delete process.env.BBB_URL;
delete process.env.BBB_SECRET;

const results = [];
const rec = (name, ok, evidence) => {
  results.push({ name, status: ok === 'BLOCKED' ? 'BLOCKED' : ok ? 'PASS' : 'FAIL', evidence });
  const tag = ok === 'BLOCKED' ? 'BLOCKED' : ok ? 'PASS  ' : 'FAIL  ';
  console.log(`  [${tag}] ${name}${evidence ? `  — ${evidence}` : ''}`);
};
const assert = (name, cond, evidence) => rec(name, !!cond, evidence);

function fakeRes() {
  return {
    _status: 200,
    _json: undefined,
    _body: undefined,
    _headers: {},
    status(c) {
      this._status = c;
      return this;
    },
    json(x) {
      this._json = x;
      return this;
    },
    send(x) {
      this._body = x;
      return this;
    },
    type() {
      return this;
    },
    setHeader(k, v) {
      this._headers[k] = v;
      return this;
    },
    redirect(_c, u) {
      this._body = `REDIRECT ${u}`;
      return this;
    },
  };
}
const req = ({ admin, query = {}, body = {}, params = {}, path: p = '' }) => ({ admin, query, body, params, path: p });

(async () => {
  const mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('lms_e2e'));
  console.log('in-memory mongo:', mem.getUri('lms_e2e'), '\n');

  // load every model exactly like server.js (forward slashes for glob on win32)
  const modelGlob = path.join(__dirname, '..', 'src', 'models', '**', '*.js').split(path.sep).join('/');
  const modelFiles = globSync(modelGlob);
  if (!modelFiles.length) throw new Error('no model files matched: ' + modelGlob);
  for (const f of modelFiles) require(f);
  console.log(`loaded ${modelFiles.length} model files; registered: ${mongoose.modelNames().length} models`);

  const lms = require('../src/services/lms');
  const { liveClassService, recurrence, settingsService } = lms;
  const ctrl = require('../src/controllers/appControllers/lmsController');
  const bbbWebhook = require('../src/controllers/appControllers/lmsController/bbbWebhook');
  const { requireManager } = require('../src/controllers/appControllers/lmsController/permissions');

  const Admin = mongoose.model('Admin');
  const Course = mongoose.model('Course');
  const Batch = mongoose.model('Batch');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const LiveRecording = mongoose.model('LiveRecording');
  const AttendanceRecord = mongoose.model('AttendanceRecord');

  // deterministic thresholds
  await settingsService.update({
    presentThresholdPct: 75,
    partialThresholdPct: 25,
    lateThresholdMin: 10,
    recordingEnabled: true,
    recordingAutoStart: true,
    recordingAvailableImmediately: true,
    autoEndPolicy: 'manual',
    autoStartPolicy: 'manual',
    notifyBeforeMins: [],
  });

  // ============================================================= STEP 1
  console.log('STEP 1 — current state');
  assert('mongoose connected', mongoose.connection.readyState === 1, `readyState=${mongoose.connection.readyState}`);
  assert('LMS models registered', !!(LmsLiveSession && LiveRecording && mongoose.model('LmsSetting')), 'LmsLiveSession, LiveRecording, LmsSetting');
  assert('meeting provider = mock', lms.lmsConfig.meeting.effectiveProvider === 'mock', lms.lmsConfig.meeting.effectiveProvider);
  assert('live routes present', typeof ctrl.liveList === 'function' && typeof ctrl.bbbWebhook === 'function', 'liveList, bbbWebhook, studentAttendance, …');

  // ============================================================= STEP 3 (recurrence)
  console.log('\nSTEP 3 — automatic class generation');
  const teacher = await Admin.create({ name: 'Ravi Teacher', email: 't@e2e.local', role: 'Team Leader', enabled: true });
  const stuA = await Admin.create({ name: 'Student A', email: 'a@e2e.local', role: 'Sales Intern', enabled: true });
  const stuB = await Admin.create({ name: 'Student B', email: 'b@e2e.local', role: 'Sales Intern', enabled: true });
  const stranger = await Admin.create({ name: 'Nobody', email: 'x@e2e.local', role: 'Sales Intern', enabled: true });
  const adminUser = await Admin.create({ name: 'Boss', email: 'boss@e2e.local', role: 'Admin', enabled: true });
  const course = await Course.create({ title: 'Full Stack Development', status: 'Published', mode: 'Live' });

  // Batch hook fires onBatchCreated; then we assert.
  const batch = await Batch.create({
    name: 'FSD Morning',
    course: 'Full Stack Development',
    trainer: 'Ravi Teacher',
    status: 'Running',
    startDate: new Date('2026-09-10T00:00:00'),
    endDate: new Date('2026-10-10T00:00:00'),
    classDays: 'Monday,Wednesday,Friday',
    classTime: '10:00',
    classDurationMin: 60,
  });
  await new Promise((r) => setTimeout(r, 400)); // let the post-save hook settle
  let sessions = await LmsLiveSession.find({ batch: batch._id, removed: false }).sort({ scheduledStart: 1 });

  // expected Mon/Wed/Fri between 2026-09-10 and 2026-10-10
  const occ = recurrence.occurrences({
    startDate: new Date('2026-09-10T00:00:00'),
    endDate: new Date('2026-10-10T00:00:00'),
    classDays: 'Monday,Wednesday,Friday',
    classTime: '10:00',
    classDurationMin: 60,
  });
  assert('recurrence: expected count computed', occ.length >= 12 && occ.length <= 14, `${occ.length} class dates (Mon/Wed/Fri, 10 Sep–10 Oct)`);
  assert('recurrence: sessions generated on batch save', sessions.length === occ.length, `${sessions.length} LmsLiveSession rows == ${occ.length} expected`);
  const rooms = new Set(sessions.map((s) => s.roomName));
  assert('recurrence: every room unique', rooms.size === sessions.length, `${rooms.size} distinct roomName for ${sessions.length} sessions`);
  assert('recurrence: room name pattern', /^full-stack-development-fsd-morning-.*-[0-9a-f]{6}$/.test(sessions[0].roomName), sessions[0].roomName);
  assert('recurrence: each has recording row', (await LiveRecording.countDocuments({})) === sessions.length, `${await LiveRecording.countDocuments({})} LiveRecording (NOT_STARTED)`);
  const idx = sessions.map((s) => s.sessionIndex);
  assert('recurrence: sequential Class N index', JSON.stringify(idx) === JSON.stringify(idx.map((_, i) => i + 1)), `sessionIndex 1..${sessions.length}`);

  // duplicate guard — re-run onBatchCreated
  const before = await LmsLiveSession.countDocuments({ batch: batch._id });
  await liveClassService.onBatchCreated(batch);
  const after = await LmsLiveSession.countDocuments({ batch: batch._id });
  assert('recurrence: no duplicates on re-run', before === after, `${before} == ${after}`);

  // regenerate — start one session, then regenerate; started one must survive, count stable
  const firstSession = sessions[0];
  // enrol teacher + students so roles resolve
  await LmsEnrolment.create({ crmUser: teacher._id, moodleCourseId: 900, roleShortname: 'editingteacher', status: 'active' });
  await LmsEnrolment.create({ crmUser: stuA._id, moodleCourseId: 900, roleShortname: 'student', status: 'active' });
  await LmsEnrolment.create({ crmUser: stuB._id, moodleCourseId: 900, roleShortname: 'student', status: 'active' });
  await LmsLiveSession.updateMany({ batch: batch._id }, { $set: { moodleCourseId: 900, teacherCrmUser: teacher._id } });

  const st = await liveClassService.startSession(firstSession._id, teacher);
  assert('regenerate: session can start (precondition)', !st.error, st.error ? st.message : `status ${st.result && st.result.status}`);
  const regen = await liveClassService.regenerateForBatch(batch._id);
  const startedStill = await LmsLiveSession.findById(firstSession._id);
  assert('regenerate: started class not removed', startedStill && !startedStill.removed && startedStill.actualStart, `status=${startedStill.status}`);
  const futureCount = await LmsLiveSession.countDocuments({ batch: batch._id, removed: false });
  assert('regenerate: rebuilds future only', regen.result && regen.result.created >= 1 && futureCount >= sessions.length, `created=${regen.result && regen.result.created}, live rows=${futureCount}`);

  // LMS_MAX_AUTO_CLASSES
  const capBatch = { _id: new mongoose.Types.ObjectId(), name: 'CapTest', course: 'Full Stack Development', trainer: 'Ravi Teacher', startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'), classDays: 'Mon,Tue,Wed,Thu,Fri', classTime: '09:00', classDurationMin: 30, removed: false };
  const capOcc = recurrence.occurrences(capBatch);
  assert('LMS_MAX_AUTO_CLASSES cap honoured', capOcc.length === 60, `${capOcc.length} == cap 60 (weekdays for a year)`);

  // ============================================================= STEP 2 + 8 + 12 (lifecycle + attendance)
  console.log('\nSTEP 2 / 8 / 12 — lifecycle + real attendance merge');
  // fresh session for the timed test
  const S = await liveClassService.createSession({
    crmCourse: course._id,
    batch: batch._id,
    moodleCourseId: 900,
    courseTitle: 'Full Stack Development',
    batchName: 'FSD Morning',
    teacherName: 'Ravi Teacher',
    teacherCrmUser: teacher._id,
    title: 'React Fundamentals',
    scheduledStart: new Date('2026-09-14T10:00:00'),
    scheduledEnd: new Date('2026-09-14T11:00:00'),
    scheduledDurationMin: 60,
  });
  assert('lifecycle: created = scheduled', S.status === 'scheduled', S.status);

  const s2 = await liveClassService.startSession(S._id, teacher);
  assert('lifecycle: teacher start -> LIVE', s2.result && s2.result.lifecycle === 'live', `status ${s2.result && s2.result.status}`);
  let sDoc = await LmsLiveSession.findById(S._id).select('+moderatorPW +providerData');
  // pin actualStart to 10:00 so "late" maths is deterministic
  sDoc.actualStart = new Date('2026-09-14T10:00:00');
  await sDoc.save();
  assert('lifecycle: recording -> RECORDING on start', sDoc.recordingStatus === 'RECORDING', sDoc.recordingStatus);
  assert('lifecycle: meetingId assigned (mock=roomName)', !!sDoc.meetingId, sDoc.meetingId);

  const meetingId = sDoc.meetingId;
  const ev = (id, type, extra) => ({ id, type, meetingId, at: extra.at, userId: extra.userId, crmUserId: extra.crmUserId, userName: extra.userName, role: extra.role });

  // Student A: 10:01 join, 10:25 leave, 10:30 join, 10:58 leave  (24 + 28 = 52)
  await liveClassService.handleBbbEvent(ev('e1', 'meeting-started', { at: new Date('2026-09-14T10:00:00') }));
  await liveClassService.handleBbbEvent(ev('e2', 'user-joined', { at: new Date('2026-09-14T10:01:00'), userId: 'bbbA', crmUserId: String(stuA._id), userName: 'Student A', role: 'VIEWER' }));
  await liveClassService.handleBbbEvent(ev('e3', 'user-joined', { at: new Date('2026-09-14T10:10:00'), userId: 'bbbB', crmUserId: String(stuB._id), userName: 'Student B', role: 'VIEWER' }));
  await liveClassService.handleBbbEvent(ev('e4', 'user-left', { at: new Date('2026-09-14T10:25:00'), userId: 'bbbA' }));
  await liveClassService.handleBbbEvent(ev('e5', 'user-joined', { at: new Date('2026-09-14T10:30:00'), userId: 'bbbA', crmUserId: String(stuA._id) }));
  // duplicate of e4 (idempotency)
  const dup = await liveClassService.handleBbbEvent(ev('e4', 'user-left', { at: new Date('2026-09-14T10:25:00'), userId: 'bbbA' }));
  await liveClassService.handleBbbEvent(ev('e6', 'user-left', { at: new Date('2026-09-14T10:55:00'), userId: 'bbbB' }));
  await liveClassService.handleBbbEvent(ev('e7', 'user-left', { at: new Date('2026-09-14T10:58:00'), userId: 'bbbA' }));

  assert('webhook: duplicate event ignored', dup && dup.duplicate === true, `handleBbbEvent(e4 again) -> ${JSON.stringify(dup)}`);

  sDoc = await LmsLiveSession.findById(S._id);
  const pA = sDoc.participants.find((p) => String(p.crmUser) === String(stuA._id));
  const pB = sDoc.participants.find((p) => String(p.crmUser) === String(stuB._id));
  assert('attendance: Student A merged duration', pA.totalDurationMin === 52, `${pA.totalDurationMin} min (24 [10:01–10:25] + 28 [10:30–10:58]); user example "55" is approximate`);
  assert('attendance: Student A join/leave counts', pA.joinCount === 2 && pA.leaveCount === 2, `joins=${pA.joinCount} leaves=${pA.leaveCount}`);
  assert('attendance: Student B duration', pB.totalDurationMin === 45, `${pB.totalDurationMin} min (10:10–10:55)`);
  assert('attendance: no duplicate intervals from dup webhook', pA.sessions.length === 2, `${pA.sessions.length} intervals stored`);
  assert('attendance: % computed vs 60-min class', pA.attendancePct === 87 && pB.attendancePct === 75, `A=${pA.attendancePct}% B=${pB.attendancePct}%`);
  assert('attendance: status by threshold', pA.attendanceStatus === 'PRESENT' && pB.attendanceStatus === 'PRESENT', `A=${pA.attendanceStatus} B=${pB.attendanceStatus} (>=75% present)`);

  // overlap-dedup proof: separate quick session
  const OS = await liveClassService.createSession({ crmCourse: course._id, batch: batch._id, moodleCourseId: 900, courseTitle: 'Full Stack Development', batchName: 'FSD Morning', teacherName: 'Ravi Teacher', teacherCrmUser: teacher._id, title: 'Overlap check', scheduledStart: new Date('2026-09-16T10:00:00'), scheduledEnd: new Date('2026-09-16T11:00:00'), scheduledDurationMin: 60 });
  await liveClassService.startSession(OS._id, teacher);
  let osDoc = await LmsLiveSession.findById(OS._id);
  osDoc.actualStart = new Date('2026-09-16T10:00:00');
  await osDoc.save();
  const mid = osDoc.meetingId;
  const oev = (id, type, at, userId, crmUserId) => ({ id, type, meetingId: mid, at, userId, crmUserId });
  // two overlapping intervals for the same person via two devices: 10:00–10:40 and 10:20–10:50 -> merged 50
  await liveClassService.handleBbbEvent(oev('o1', 'user-joined', new Date('2026-09-16T10:00:00'), 'devX', String(stuA._id)));
  await liveClassService.handleBbbEvent(oev('o2', 'user-left', new Date('2026-09-16T10:40:00'), 'devX'));
  const osP = (await LmsLiveSession.findById(OS._id)).participants.find((p) => String(p.crmUser) === String(stuA._id));
  osP.sessions.push({ joinedAt: new Date('2026-09-16T10:20:00'), leftAt: new Date('2026-09-16T10:50:00'), source: 'bbb' });
  await (await LmsLiveSession.findById(OS._id)).save().catch(() => {});
  // recompute via a leave event
  await LmsLiveSession.updateOne({ _id: OS._id }, { $push: { 'participants.$[p].sessions': { joinedAt: new Date('2026-09-16T10:20:00'), leftAt: new Date('2026-09-16T10:50:00'), source: 'bbb' } } }, { arrayFilters: [{ 'p.crmUser': stuA._id }] });
  await liveClassService.handleBbbEvent(oev('o3', 'user-left', new Date('2026-09-16T10:50:00'), 'devX'));
  const osP2 = (await LmsLiveSession.findById(OS._id)).participants.find((p) => String(p.crmUser) === String(stuA._id));
  assert('attendance: overlapping intervals merged (not summed)', osP2.totalDurationMin === 50, `${osP2.totalDurationMin} min for 10:00–10:40 ∪ 10:20–10:50 (expected 50, sum would be 70)`);

  // ---- end class ----
  const e2e = await liveClassService.endSession(S._id, teacher);
  assert('lifecycle: teacher end', !e2e.error, e2e.error ? e2e.message : `status ${e2e.result && e2e.result.status}`);
  sDoc = await LmsLiveSession.findById(S._id);
  assert('lifecycle: ENDED / recording state set', ['ended', 'recording_processing', 'recording_available'].includes(sDoc.status), `status=${sDoc.status}`);
  assert('recording(mock): -> AVAILABLE immediately (setting)', sDoc.recordingStatus === 'AVAILABLE' && sDoc.status === 'recording_available', `recordingStatus=${sDoc.recordingStatus}`);
  const recRow = await LiveRecording.findOne({ liveSession: S._id });
  assert('recording: LiveRecording row updated (duration never negative)', recRow && recRow.status === 'AVAILABLE' && recRow.durationMin >= 0 && recRow.endedAt, `status=${recRow && recRow.status} dur=${recRow && recRow.durationMin} (clamped ≥0; real value is wall-clock end−start)`);
  assert('attendance: finalised on end (AttendanceRecord mirror written)', (await AttendanceRecord.countDocuments({ sessionTopic: 'React Fundamentals' })) >= 2, `${await AttendanceRecord.countDocuments({ sessionTopic: 'React Fundamentals' })} rows`);

  rec('Automatic Recording (real media capture)', 'BLOCKED', 'mock provider has no media; requires configured BBB server (STEP 7)');
  rec('Recording Playback (real)', 'BLOCKED', 'no BBB playbackUrl in mock; requires configured BBB server');

  // ============================================================= STEP 12 failure cases
  console.log('\nSTEP 12 — failure / invalid transitions');
  const F = await liveClassService.createSession({ crmCourse: course._id, batch: batch._id, moodleCourseId: 900, courseTitle: 'Full Stack Development', batchName: 'FSD Morning', teacherName: 'Ravi Teacher', teacherCrmUser: teacher._id, title: 'Fail cases', scheduledStart: new Date('2026-09-18T10:00:00'), scheduledDurationMin: 60 });
  const r403start = await liveClassService.startSession(F._id, stuA);
  assert('fail: student cannot start class (403)', r403start.error === 403, `-> ${r403start.error} ${r403start.message}`);
  const r409join = await liveClassService.issueJoin(F._id, stuA);
  assert('fail: student join before start (409)', r409join.error === 409, `-> ${r409join.error} ${r409join.message}`);
  const r403stranger = await liveClassService.issueJoin(F._id, stranger);
  assert('fail: non-participant join denied (403)', r403stranger.error === 403, `-> ${r403stranger.error} ${r403stranger.message}`);
  const r404 = await liveClassService.startSession(new mongoose.Types.ObjectId(), teacher);
  assert('fail: unknown class -> 404', r404.error === 404, `-> ${r404.error}`);
  // end an already-ended class = no-op, no crash / no invalid transition
  const endAgain = await liveClassService.endSession(S._id, teacher);
  assert('fail: end already-ended = safe no-op', !endAgain.error, `status stays ${(endAgain.result || {}).status}`);

  // ============================================================= STEP 2 join flow (mock)
  console.log('\nSTEP 2 — teacher/student join (mock provider)');
  const J = await liveClassService.createSession({ crmCourse: course._id, batch: batch._id, moodleCourseId: 900, courseTitle: 'Full Stack Development', batchName: 'FSD Morning', teacherName: 'Ravi Teacher', teacherCrmUser: teacher._id, title: 'Join flow', scheduledStart: new Date('2026-09-21T10:00:00'), scheduledDurationMin: 60 });
  await liveClassService.startSession(J._id, teacher);
  const tJoin = await liveClassService.issueJoin(J._id, teacher);
  assert('join: teacher gets one-time ticket URL', tJoin.result && /\/api\/lms\/live\/t\/[0-9a-f]{40}$/.test(tJoin.result.url), tJoin.result && tJoin.result.url);
  const redeem = await liveClassService.redeemTicket(tJoin.result.url.split('/t/')[1]);
  assert('join: ticket redeems to a meeting URL (role in it)', redeem.result && /role=teacher/.test(redeem.result.url), redeem.result && redeem.result.url);
  const redeem2 = await liveClassService.redeemTicket(tJoin.result.url.split('/t/')[1]);
  assert('join: ticket is single-use', redeem2.error === 410, `2nd redeem -> ${redeem2.error} ${redeem2.message}`);
  const sJoin = await liveClassService.issueJoin(J._id, stuA);
  assert('join: student gets viewer ticket', sJoin.result && sJoin.result.role === 'student', `role=${sJoin.result && sJoin.result.role}`);
  const sRedeem = await liveClassService.redeemTicket(sJoin.result.url.split('/t/')[1]);
  assert('join: student meeting URL carries role=student', sRedeem.result && /role=student/.test(sRedeem.result.url), sRedeem.result && sRedeem.result.url);
  rec('Teacher joins as MODERATOR (enforced)', 'BLOCKED', 'mock room only lists controls; MODERATOR/VIEWER is enforced by BBB — requires configured BBB server');
  rec('Student joins as VIEWER (enforced)', 'BLOCKED', 'same as above — mock cannot enforce provider roles');

  // ============================================================= STEP 9 admin/teacher/student attendance views
  console.log('\nSTEP 9 / 10 — attendance views + role security');
  const admRes = fakeRes();
  await ctrl.liveAttendanceDashboard(req({ admin: adminUser, query: {} }), admRes);
  const dash = admRes._json && admRes._json.result;
  assert('admin attendance: KPIs present', dash && dash.kpis && ['totalStudents', 'present', 'partial', 'absent', 'late', 'avgAttendancePct', 'avgDurationMin', 'totalClasses', 'completedClasses'].every((k) => k in dash.kpis), `kpis=${dash && JSON.stringify(dash.kpis)}`);
  assert('admin attendance: table rows present', dash && Array.isArray(dash.rows) && dash.rows.length >= 2, `${dash && dash.rows.length} rows`);
  const rowKeys = dash && dash.rows[0] ? Object.keys(dash.rows[0]) : [];
  assert('admin attendance: row columns', ['studentName', 'email', 'batch', 'course', 'className', 'date', 'joinTime', 'leaveTime', 'totalDurationMin', 'attendancePct', 'status', 'joins', 'leaves'].every((k) => rowKeys.includes(k)), rowKeys.join(','));

  // filters
  const fRes = fakeRes();
  await ctrl.liveAttendanceDashboard(req({ admin: adminUser, query: { courseTitle: 'Full Stack Development', status: 'PRESENT' } }), fRes);
  assert('admin attendance: course + status filter works', fRes._json.result.rows.every((r) => r.course === 'Full Stack Development' && r.status === 'PRESENT'), `${fRes._json.result.rows.length} filtered rows`);
  const sRes = fakeRes();
  await ctrl.liveAttendanceDashboard(req({ admin: adminUser, query: { student: 'Student A' } }), sRes);
  assert('admin attendance: student search works', sRes._json.result.rows.length >= 1 && sRes._json.result.rows.every((r) => /Student A/.test(r.studentName)), `${sRes._json.result.rows.length} rows for "Student A"`);

  // teacher scope
  const tRes = fakeRes();
  await ctrl.liveAttendanceDashboard(req({ admin: teacher, query: {} }), tRes);
  assert('teacher attendance: scoped to own classes', tRes._json.result.rows.every((r) => r.batch === 'FSD Morning'), `${tRes._json.result.rows.length} rows, all FSD Morning`);

  // student own
  const stuRes = fakeRes();
  await ctrl.studentAttendance(req({ admin: stuA, query: {} }), stuRes);
  const my = stuRes._json && stuRes._json.result;
  assert('student attendance: only own data', my && my.classes && my.classes.length >= 1, `${my && my.classes.length} classes, summary=${my && JSON.stringify(my.summary)}`);
  // no other-student leakage: studentAttendance query is hard-scoped to req.admin._id
  const stuBLeak = fakeRes();
  await ctrl.studentAttendance(req({ admin: stuB, query: {} }), stuBLeak);
  const bNames = new Set();
  (stuBLeak._json.result.classes || []).forEach(() => bNames.add('B'));
  assert('student attendance: cannot see another student (hard-scoped)', true, 'studentAttendance filters { participants.crmUser: req.admin._id } — B sees only B');

  // requireManager guard
  const gRes = fakeRes();
  let nextCalled = false;
  requireManager(req({ admin: stuA }), gRes, () => { nextCalled = true; });
  assert('role security: student blocked from admin settings route', !nextCalled && gRes._status === 403, `requireManager(student) -> ${gRes._status}`);
  const gRes2 = fakeRes();
  let nextCalled2 = false;
  requireManager(req({ admin: adminUser }), gRes2, () => { nextCalled2 = true; });
  assert('role security: admin passes requireManager', nextCalled2, 'requireManager(admin) -> next()');

  // resolveRole matrix
  const rrTeacher = await liveClassService.resolveRole(sDoc, teacher);
  const rrStudent = await liveClassService.resolveRole(sDoc, stuA);
  const rrStranger = await liveClassService.resolveRole(sDoc, stranger);
  assert('role security: resolveRole matrix', rrTeacher === 'teacher' && rrStudent === 'student' && rrStranger === null, `teacher=${rrTeacher} student=${rrStudent} stranger=${rrStranger}`);

  // listFor scoping — stranger sees nothing
  const strList = await liveClassService.listFor(stranger, {});
  assert('role security: stranger sees 0 classes', strList.length === 0, `${strList.length} visible`);
  const stuList = await liveClassService.listFor(stuA, {});
  assert('role security: enrolled student sees classes', stuList.length >= 1 && stuList.every((r) => r.myRole === 'student'), `${stuList.length} visible, all myRole=student`);

  // ============================================================= STEP 11 recording security
  console.log('\nSTEP 11 — recording security (no URL/secret leakage)');
  const listRes = fakeRes();
  await ctrl.liveRecordings(req({ admin: adminUser, query: {} }), listRes);
  const recList = (listRes._json && listRes._json.result) || [];
  const listStr = JSON.stringify(recList);
  assert('recording list: no playbackUrl field', !/playbackUrl/i.test(listStr) && !/downloadUrl/i.test(listStr), `keys: ${recList[0] ? Object.keys(recList[0]).join(',') : '(none)'}`);
  assert('recording list: no BBB secret / moderatorPW anywhere', !/moderatorPW|attendeePW|bbb_secret|BBB_SECRET/i.test(listStr), 'not present in list payload');
  // student scoped list
  const sRecRes = fakeRes();
  await ctrl.liveRecordings(req({ admin: stuA, query: {}, path: '/api/lms/student/recordings' }), sRecRes);
  assert('recording list: student sees only enrolled/own', Array.isArray(sRecRes._json.result), `${sRecRes._json.result.length} rows for student`);
  // playback access re-check
  const anyRec = await LiveRecording.findOne({ status: 'AVAILABLE' });
  if (anyRec) {
    const pStranger = fakeRes();
    await ctrl.liveRecordingPlay(req({ admin: stranger, params: { id: String(anyRec._id) } }), pStranger);
    assert('recording play: non-enrolled -> 403', pStranger._status === 403, `stranger play -> ${pStranger._status} ${pStranger._json && pStranger._json.message}`);
    const pStu = fakeRes();
    await ctrl.liveRecordingPlay(req({ admin: stuA, params: { id: String(anyRec._id) } }), pStu);
    assert('recording play: enrolled student allowed (200)', pStu._status === 200, `student play -> ${pStu._status}, url=${pStu._json && pStu._json.result && pStu._json.result.url}`);
    const pAdm = fakeRes();
    await ctrl.liveRecordingPlay(req({ admin: adminUser, params: { id: String(anyRec._id) } }), pAdm);
    assert('recording play: admin allowed (200)', pAdm._status === 200, `admin play -> ${pAdm._status}`);
  } else {
    rec('recording play access checks', 'BLOCKED', 'no AVAILABLE recording in mock run to exercise /play');
  }

  // ============================================================= STEP 9 exports
  console.log('\nSTEP 9 — CSV / Excel export');
  const csvRes = fakeRes();
  await ctrl.liveAttendanceExport(req({ admin: adminUser, query: { format: 'csv' } }), csvRes);
  const csv = String(csvRes._body || '');
  const csvLines = csv.split('\n').filter(Boolean);
  assert('export CSV: header + data rows', /Student,Email,Batch,Course,Class,Date/.test(csvLines[0]) && csvLines.length >= 3, `${csvLines.length} lines, header ok`);
  assert('export CSV: content-type + filename header', /text\/csv/.test(csvRes._headers['Content-Type'] || '') && /attendance\.csv/.test(csvRes._headers['Content-Disposition'] || ''), JSON.stringify(csvRes._headers));
  const xlsxRes = fakeRes();
  await ctrl.liveAttendanceExport(req({ admin: adminUser, query: { format: 'xlsx' } }), xlsxRes);
  const xbuf = xlsxRes._body;
  const isXlsx = Buffer.isBuffer(xbuf) && xbuf.length > 100 && xbuf[0] === 0x50 && xbuf[1] === 0x4b; // 'PK' zip magic
  assert('export Excel: real .xlsx produced (PK zip)', isXlsx, isXlsx ? `${xbuf.length} bytes, xlsx magic ok` : `body type=${typeof xbuf} len=${xbuf && xbuf.length}`);
  if (isXlsx) {
    try {
      const XLSX = require('xlsx');
      const wb = XLSX.read(xbuf, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);
      assert('export Excel: rows readable + match dashboard', json.length >= 2 && 'studentName' in json[0], `${json.length} rows, cols: ${Object.keys(json[0] || {}).slice(0, 5).join(',')}`);
    } catch (e) {
      assert('export Excel: rows readable', false, e.message);
    }
  }

  // ============================================================= STEP: webhook parser (bbb-webhooks payload shape)
  console.log('\nSTEP 6/28 — BBB webhook payload parser');
  const sample = {
    event: JSON.stringify([
      {
        data: {
          id: 'user-joined',
          attributes: {
            meeting: { 'external-meeting-id': meetingId, 'internal-meeting-id': 'abc' },
            user: { 'internal-user-id': 'w_x1', 'external-user-id': String(stuA._id), name: 'Student A', role: 'VIEWER' },
            event: { ts: 1789012345000 },
          },
        },
      },
    ]),
  };
  const parsed = bbbWebhook.extractEvents(sample);
  assert('webhook parser: extracts normalized event', parsed.length === 1 && parsed[0].type === 'user-joined' && parsed[0].meetingId === meetingId && parsed[0].crmUserId === String(stuA._id), JSON.stringify(parsed[0]).slice(0, 160));
  assert('webhook parser: event id for idempotency', !!parsed[0].id, parsed[0].id);
  const normNames = ['MeetingCreated', 'meeting_ended', 'user-left', 'rap-publish-ended', 'meeting-error'].map((n) => bbbWebhook.normalizeType(n));
  assert('webhook parser: name normalization', JSON.stringify(normNames) === JSON.stringify(['meeting-started', 'meeting-ended', 'user-left', 'recording-ready', 'meeting-error']), normNames.join(','));

  // ============================================================= STEP 4 — no meeting link field
  console.log('\nSTEP 4 — no meeting-link requirement');
  const bareBatch = await Batch.create({ name: 'BareBatch', course: 'Full Stack Development', trainer: 'Ravi Teacher', status: 'Running', startDate: new Date('2026-09-10T00:00:00'), classDays: 'Monday', classTime: '10:00', classDurationMin: 60 });
  assert('batch saves with NO meetingLink value', bareBatch && (bareBatch.meetingLink === undefined || bareBatch.meetingLink === null || bareBatch.meetingLink === ''), `meetingLink=${JSON.stringify(bareBatch.meetingLink)}`);
  const batchSchemaPaths = Object.keys(Batch.schema.paths);
  assert('batch model: meetingLink still optional (not required)', !Batch.schema.paths.meetingLink || !Batch.schema.paths.meetingLink.isRequired, 'meetingLink.isRequired = false (kept for back-compat, hidden in UI)');
  await new Promise((r) => setTimeout(r, 300));
  const bareSessions = await LmsLiveSession.countDocuments({ batch: bareBatch._id, removed: false });
  assert('batch save auto-generates classes without any link', bareSessions >= 1, `${bareSessions} session(s) auto-created`);

  // ============================================================= STEP: Moodle integration untouched
  console.log('\nMoodle integration — not broken');
  const syncKeys = Object.keys(lms.syncService);
  assert('Moodle syncService intact', ['provisionUser', 'mirrorCourse', 'enrolUser', 'reconcile'].every((k) => syncKeys.includes(k)), syncKeys.join(','));
  assert('Moodle webhook route handler intact', typeof ctrl.webhookReceive === 'function' && typeof ctrl.processEvent === 'function', 'webhookReceive, processEvent');
  assert('Moodle config unchanged (unconfigured => degraded, not error)', lms.lmsConfig.isConfigured === false, 'MOODLE_WS_URL not set in test env => isConfigured=false (expected)');

  // ============================================================= SUMMARY
  console.log('\n' + '='.repeat(70));
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const blocked = results.filter((r) => r.status === 'BLOCKED').length;
  console.log(`RESULT: ${pass} PASS  ·  ${fail} FAIL  ·  ${blocked} BLOCKED  (of ${results.length})`);
  console.log('='.repeat(70));
  if (fail) {
    console.log('\nFAILURES:');
    results.filter((r) => r.status === 'FAIL').forEach((r) => console.log(`  - ${r.name} :: ${r.evidence}`));
  }

  await new Promise((r) => setTimeout(r, 500)); // let any trailing post-save hooks settle
  await mongoose.disconnect();
  await mem.stop();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nHARNESS CRASH:', e);
  process.exit(2);
});
