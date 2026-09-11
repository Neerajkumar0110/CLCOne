const mongoose = require('mongoose');
const { liveClassService } = require('../../../services/lms');

// HTTP layer for live classes. Thin — all logic is in
// services/lms/liveClassService.js. The real meeting URL is never in a
// response body; "join" returns a one-time ticket URL that redirects.

function send(res, out) {
  if (out.error) return res.status(out.error).json({ success: false, message: out.message });
  return res.status(200).json({ success: true, result: out.result });
}

// GET /api/lms/liveclasses?scope=upcoming|live|ended
async function list(req, res) {
  const rows = await liveClassService.listFor(req.admin, { scope: req.query.scope });
  return res.status(200).json({ success: true, result: rows });
}

// GET /api/lms/liveclasses/:id
async function get(req, res) {
  return send(res, await liveClassService.getOne(req.params.id, req.admin));
}

// POST /api/lms/liveclasses  { batchId? , crmCourseId?, title, scheduledStart, scheduledEnd?, teacherName? }
// Manual "schedule a live class" (in addition to the one auto-created per batch).
async function create(req, res) {
  const b = req.body || {};
  const Batch = mongoose.model('Batch');
  const Course = mongoose.model('Course');
  const MoodleObjectMap = mongoose.model('MoodleObjectMap');

  let batch = b.batchId ? await Batch.findById(b.batchId) : null;
  let course = b.crmCourseId ? await Course.findById(b.crmCourseId) : null;
  if (!course && batch && batch.course) course = await Course.findOne({ title: batch.course, removed: false });
  const courseMap = course ? await MoodleObjectMap.findOne({ kind: 'course', crmId: course._id }) : null;

  const session = await liveClassService.createSession({
    crmCourse: course ? course._id : undefined,
    batch: batch ? batch._id : undefined,
    moodleCourseId: courseMap ? courseMap.moodleId : undefined,
    courseTitle: (course && course.title) || (batch && batch.course) || b.courseTitle || '',
    batchName: (batch && batch.name) || b.batchName || '',
    teacherName: b.teacherName || (batch && batch.trainer) || '',
    title: b.title || `${(batch && batch.name) || 'Live'} class`,
    description: b.description || '',
    scheduledStart: b.scheduledStart,
    scheduledEnd: b.scheduledEnd,
    autoCreated: false,
  });
  return res.status(200).json({ success: true, result: liveClassService.safeView(session, 'teacher') });
}

// PATCH /api/lms/liveclasses/:id  { scheduledStart?, scheduledDurationMin?, scheduledEnd?, title?, description?, autoStartAt? }
async function updateTime(req, res) {
  return send(res, await liveClassService.updateSchedule(req.params.id, req.admin, req.body || {}));
}

// POST /api/lms/batches/:id/students  { email, name?, crmUserId? }
async function addStudent(req, res) {
  const b = req.body || {};
  return send(res, await liveClassService.addStudentToBatch({ batchId: req.params.id, email: b.email, name: b.name, crmUserId: b.crmUserId }, req.admin));
}

// GET /api/lms/students/search?q=
async function studentSearch(req, res) {
  return send(res, await liveClassService.searchStudents(req.query.q));
}

// GET /api/lms/batches/:id/students
async function batchStudents(req, res) {
  return send(res, await liveClassService.listBatchStudents(req.params.id));
}

// POST /api/lms/batches/:id/students/remove  { studentId?, crmUserId?, email? }
async function removeStudent(req, res) {
  const b = req.body || {};
  return send(res, await liveClassService.removeStudentFromBatch({ batchId: req.params.id, studentId: b.studentId, crmUserId: b.crmUserId, email: b.email }, req.admin));
}

// POST /api/lms/liveclasses/:id/start
async function start(req, res) {
  return send(res, await liveClassService.startSession(req.params.id, req.admin));
}

// POST /api/lms/liveclasses/:id/end
async function end(req, res) {
  return send(res, await liveClassService.endSession(req.params.id, req.admin));
}

// POST /api/lms/liveclasses/:id/join  -> { url: ticket redirect, expiresInSec }
async function join(req, res) {
  return send(res, await liveClassService.issueJoin(req.params.id, req.admin));
}

// POST /api/lms/liveclasses/:id/leave
async function leave(req, res) {
  return send(res, await liveClassService.recordLeave(req.params.id, req.admin._id));
}

// GET /api/lms/liveclasses/:id/attendance  (teacher / manager)
async function attendance(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const s = await LmsLiveSession.findById(req.params.id);
  if (!s || s.removed) return res.status(404).json({ success: false, message: 'Live class not found.' });
  const role = await liveClassService.resolveRole(s, req.admin);
  if (role !== 'teacher') return res.status(403).json({ success: false, message: 'Teachers only.' });
  return res.status(200).json({ success: true, result: liveClassService.attendanceRows(s) });
}

// POST /api/lms/liveclasses/:id/regenerate  (manager) — rebuild a batch's
// future un-started sessions from its current schedule.
async function regenerate(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const s = await LmsLiveSession.findById(req.params.id);
  const batchId = (req.body && req.body.batchId) || (s && s.batch);
  if (!batchId) return res.status(400).json({ success: false, message: 'batchId required.' });
  const out = await liveClassService.regenerateForBatch(batchId);
  if (out.error) return res.status(out.error).json({ success: false, message: out.message });
  return res.status(200).json({ success: true, result: out.result });
}

// GET /api/lms/liveclasses/:id/open  (browser hits this from the LiveClass
// mirror row's joinUrl) — bearer-gated; bounces to the ticket flow via a
// tiny auto-submit page so it works from a plain link too.
async function openEntry(req, res) {
  const out = await liveClassService.issueJoin(req.params.id, req.admin);
  if (out.error) return res.status(out.error).type('text/plain').send(out.message);
  return res.redirect(302, out.result.url);
}

// ── pre-bearer: browser-navigable "open class" entry ────────────────────
// GET /api/lms/live/open/:id?t=<crm jwt>  — a plain link (email/calendar/the
// LiveClass mirror row) lands here. Browser navigation can't send the
// Authorization header, so the CRM JWT is accepted as ?t=. On success it 302s
// into the one-time ticket flow; on a missing/expired token it serves a
// friendly HTML page, never the raw "jwtExpired" JSON.
async function openPublic(req, res) {
  const jwt = require('jsonwebtoken');
  const mongoose2 = require('mongoose');
  const t = req.query.t || req.query.token || '';
  const page = (title, msg) =>
    res
      .status(200)
      .type('html')
      .send(
        `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">` +
          `<title>${title}</title><div style="font:16px/1.6 system-ui,sans-serif;max-width:520px;margin:56px auto;padding:0 20px;color:#17202c">` +
          `<h2 style="margin:0 0 8px">${title}</h2><p>${msg}</p>` +
          `<p><a href="/#/lms/classes" style="color:#2f5fd0;font-weight:600">Open Live Classes &rarr;</a></p></div>`
      );

  if (!t) return page('Sign in required', 'Open the CRM, go to <b>LMS &rarr; Live Classes</b> and click <b>Join</b> on your class.');
  let decoded;
  try {
    decoded = jwt.verify(t, process.env.JWT_SECRET);
  } catch (e) {
    return page('Session expired', 'Your sign-in link has expired. Open the CRM &rarr; <b>LMS &rarr; Live Classes</b> and click <b>Join</b>.');
  }
  const admin = await mongoose2.model('Admin').findOne({ _id: decoded.id, removed: false });
  if (!admin) return page('Sign in required', 'Open the CRM &rarr; <b>LMS &rarr; Live Classes</b> and click <b>Join</b>.');

  const out = await liveClassService.issueJoin(req.params.id, admin);
  if (out.error) {
    return page(
      out.error === 409 ? 'Class not started' : 'Cannot join',
      out.error === 409 ? 'The class has not started yet. Try again once the teacher starts it.' : out.message
    );
  }
  return res.redirect(302, out.result.url);
}

// ── pre-bearer: ticket redirect + logout/leave ping ──────────────────────
// GET /api/lms/live/t/:ticket             -> 302 to the real meeting URL (one-time)
// GET /api/lms/live/t/:ticket?embed=1     -> JSON { embed: {...} } for the
//   in-app Jitsi iframe (frontend/src/pages/Lms/components/JitsiEmbed.jsx),
//   when the provider supports it — otherwise falls back to the same 302.
async function ticket(req, res) {
  const wantsEmbed = req.query.embed === '1';
  const out = await liveClassService.redeemTicket(req.params.ticket, { embed: wantsEmbed });
  if (out.error) {
    if (wantsEmbed) return res.status(out.error).json({ success: false, message: out.message });
    return res.status(out.error).type('text/plain').send(out.message);
  }
  if (out.result.embed) return res.status(200).json({ success: true, result: out.result });
  return res.redirect(302, out.result.url);
}

// GET|POST /api/lms/live/left?s=<sessionId>&u=<crmUserId>   (BBB logoutURL / beacon)
async function left(req, res) {
  const sid = req.query.s || (req.body && req.body.s);
  const uid = req.query.u || (req.body && req.body.u);
  if (sid && uid) await liveClassService.recordLeave(sid, uid).catch(() => {});
  // BBB redirects the browser here — send them somewhere friendly
  return res.status(200).type('html').send('<!doctype html><meta charset=utf-8><title>Left class</title><p style="font:16px system-ui;margin:40px">You left the class. You can close this tab.</p>');
}

// GET /api/lms/live/mock/:id?k=<publicKey>&role=teacher|student&u=<crmUserId>
// The stand-in "meeting room" used only while meetingProvider === 'mock'
// (no BigBlueButton). Clearly labelled. Real video providers never hit this.
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function mockRoom(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const s = await LmsLiveSession.findById(req.params.id).select('+publicKey').catch(() => null);
  if (!s || s.removed) return res.status(404).type('text/plain').send('Class not found.');
  const k = String(req.query.k || '');
  if (!s.publicKey || k.length !== s.publicKey.length) return res.status(403).type('text/plain').send('Invalid room key.');
  const role = req.query.role === 'teacher' ? 'teacher' : 'student';
  const uid = esc(req.query.u || '');
  const controls =
    role === 'teacher'
      ? ['Video / audio', 'Screen sharing', 'Participants', 'Chat', 'Mic / camera controls', 'Participant management', 'Attendance', 'Start / End class', 'Recording controls', 'Teacher controls']
      : ['Live class video', 'Audio / video (as permitted)', 'Chat / messages', 'Participant view', 'Leave class'];
  return res.status(200).type('html').send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(s.title)} — mock room</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:620px;margin:36px auto;padding:0 16px;color:#17202c}
.tag{font:600 11px/1 ui-monospace,monospace;letter-spacing:.08em;background:#f7ecdb;color:#b3721a;border:1px solid #e0c188;border-radius:5px;padding:4px 8px}
.card{border:1px solid #dde3ea;border-radius:12px;padding:16px 18px;margin:16px 0}
ul{margin:6px 0 0 18px}button{font:inherit;padding:9px 14px;border-radius:8px;border:1px solid #c9d2dc;background:#fff;cursor:pointer}</style>
<p><span class=tag>MOCK MEETING · provider = mock</span></p>
<h2>${esc(s.title)}</h2><p>${esc(s.description)}</p>
<div class=card><strong>${role === 'teacher' ? 'Teacher' : 'Student'} view</strong> — a real BigBlueButton room replaces this once BBB is configured.<ul>${controls.map((c) => `<li>${c}</li>`).join('')}</ul></div>
<div class=card>You are in the room. Attendance is being recorded.<br><br>
<button onclick="fetch('/api/lms/live/left?s=${s._id}&u=${uid}',{method:'POST'}).then(()=>document.body.innerHTML='<p style=\\'font:16px system-ui;margin:40px\\'>You left the class.</p>')">Leave class</button></div>`);
}

module.exports = { list, get, create, updateTime, addStudent, studentSearch, batchStudents, removeStudent, start, end, join, leave, attendance, regenerate, openEntry, openPublic, ticket, left, mockRoom };
