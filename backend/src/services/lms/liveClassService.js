const crypto = require('crypto');
const mongoose = require('mongoose');
const { lmsConfig } = require('../../config/lms');
const { getMeetingProvider } = require('./meeting');
const settingsService = require('./settingsService');
const recurrence = require('./recurrence');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES, LMS_STUDENT_ROLES } = require('../../config/roles');

// Live-class orchestration: auto room, SCHEDULED..RECORDING_AVAILABLE
// lifecycle, multi-session attendance (webhook-authoritative), recording
// lifecycle, role-scoped reads. Additive — no change to Batch/Course/Student.

const TAG = '[LMS-LIVE]';

/* ───────────────────────── helpers ───────────────────────── */
function slugPart(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}
function computeRoomName(courseTitle, batchName, classTitle) {
  const uid = crypto.randomBytes(3).toString('hex');
  const left = [slugPart(courseTitle), slugPart(batchName), slugPart(classTitle)].filter(Boolean).join('-') || 'class';
  return `${left}-${uid}`.slice(0, 120);
}
// One stable name for a whole batch (no per-class part) — the "same link".
function computeBatchRoomName(courseTitle, batchName) {
  const uid = crypto.randomBytes(3).toString('hex');
  const left = [slugPart(courseTitle), slugPart(batchName)].filter(Boolean).join('-') || 'batch';
  return `${left}-${uid}`.slice(0, 120);
}

// Pre-v2 LmsLiveSession docs used lowercase recording / attendance enums and a
// flat participant shape. Coerce in memory so .save() on a legacy doc doesn't
// fail validation. Full migration: scripts/lms-live-migrate.cjs.
const REC_ENUM = ['NOT_STARTED', 'RECORDING', 'PROCESSING', 'AVAILABLE', 'FAILED', 'DELETED'];
const ATT_ENUM = ['PRESENT', 'PARTIAL', 'ABSENT', 'LATE', 'EXCUSED'];
function coerceLegacy(session) {
  if (!session) return session;
  const rs = { none: 'NOT_STARTED', not_started: 'NOT_STARTED', recording: 'RECORDING', processing: 'PROCESSING', available: 'AVAILABLE', failed: 'FAILED', deleted: 'DELETED' };
  if (session.recordingStatus && !REC_ENUM.includes(session.recordingStatus)) {
    session.recordingStatus = rs[String(session.recordingStatus).toLowerCase()] || 'NOT_STARTED';
  }
  for (const p of session.participants || []) {
    if (p.attendanceStatus && !ATT_ENUM.includes(p.attendanceStatus)) {
      const up = String(p.attendanceStatus).toUpperCase();
      p.attendanceStatus = ATT_ENUM.includes(up) ? up : 'ABSENT';
    }
    const raw = (p.toObject ? p.toObject() : p) || {};
    if (!p.firstJoinAt && raw.joinedAt) p.firstJoinAt = raw.joinedAt;
    if (!p.lastLeftAt && raw.leftAt) p.lastLeftAt = raw.leftAt;
    if ((!p.sessions || p.sessions.length === 0) && raw.joinedAt) {
      p.sessions = [{ joinedAt: raw.joinedAt, leftAt: raw.leftAt || undefined, durationMin: raw.durationMin || 0, source: 'reconcile' }];
    }
    if (!p.totalDurationMin && raw.durationMin) p.totalDurationMin = raw.durationMin;
  }
  return session;
}
function crmBase() {
  return lmsConfig.meeting.crmBaseUrl.replace(/\/+$/, '');
}
const isManager = (a) => !!(a && (MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role)));

// True while "now" is inside the class's scheduled time (± a small grace
// buffer) — used so a class that got marked 'ended' early (a slip of the
// End button, or the auto-lifecycle tick firing a bit ahead of schedule)
// can still be re-joined for as long as the batch's actual class time is
// running, instead of being permanently over the moment someone ends it.
const JOIN_WINDOW_GRACE_MIN = 10;
function withinScheduledWindow(session) {
  if (!session.scheduledStart) return false;
  const start = new Date(session.scheduledStart).getTime();
  const end = session.scheduledEnd
    ? new Date(session.scheduledEnd).getTime()
    : start + (session.scheduledDurationMin || 60) * 60000;
  const now = Date.now();
  return now >= start - JOIN_WINDOW_GRACE_MIN * 60000 && now <= end + JOIN_WINDOW_GRACE_MIN * 60000;
}
const DISPLAY = {
  scheduled: 'SCHEDULED',
  upcoming: 'UPCOMING',
  starting: 'STARTING',
  live: 'LIVE',
  ending: 'ENDING',
  ended: 'ENDED',
  recording_processing: 'RECORDING_PROCESSING',
  recording_available: 'RECORDING_AVAILABLE',
  cancelled: 'CANCELLED',
};

/* ───────────────────────── attendance maths ───────────────────────── */
function openInterval(p, at, source, providerUserId) {
  const open = p.sessions.find((s) => !s.leftAt);
  if (open) return open;
  p.sessions.push({ joinedAt: at, source: source || 'crm', providerUserId });
  p.joinCount = (p.joinCount || 0) + 1;
  if (!p.firstJoinAt || at < p.firstJoinAt) p.firstJoinAt = at;
  p.online = true;
  return p.sessions[p.sessions.length - 1];
}
function closeInterval(p, at, source) {
  const open = p.sessions.find((s) => !s.leftAt);
  if (!open) return;
  open.leftAt = at;
  if (source) open.source = source;
  open.durationMin = Math.max(0, Math.round((open.leftAt - open.joinedAt) / 60000));
  p.leaveCount = (p.leaveCount || 0) + 1;
  p.lastLeftAt = at;
  p.online = p.sessions.some((s) => !s.leftAt);
}
function recompute(p, session, s) {
  // merge overlapping intervals, then sum
  const iv = p.sessions
    .filter((x) => x.joinedAt)
    .map((x) => [+new Date(x.joinedAt), +new Date(x.leftAt || session.actualEnd || Date.now())])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curA = null;
  let curB = null;
  for (const [a, b] of iv) {
    if (curB === null) {
      curA = a;
      curB = b;
    } else if (a <= curB) {
      curB = Math.max(curB, b);
    } else {
      total += curB - curA;
      curA = a;
      curB = b;
    }
  }
  if (curB !== null) total += curB - curA;
  p.totalDurationMin = Math.round(total / 60000);

  const scheduled = session.scheduledDurationMin || 60;
  p.attendancePct = scheduled > 0 ? Math.min(100, Math.round((p.totalDurationMin / scheduled) * 100)) : 0;

  // late = first join later than lateThreshold after actual/scheduled start
  const start = session.actualStart || session.scheduledStart;
  if (start && p.firstJoinAt) p.lateBySec = Math.max(0, Math.round((new Date(p.firstJoinAt) - new Date(start)) / 1000));
  const lateFlag = p.lateBySec > (s.lateThresholdMin || 10) * 60;

  if (p.attendanceStatus === 'EXCUSED') {
    p.present = true;
  } else if (p.attendancePct >= s.presentThresholdPct) {
    p.attendanceStatus = lateFlag ? 'LATE' : 'PRESENT';
    p.present = true;
  } else if (p.attendancePct >= s.partialThresholdPct) {
    p.attendanceStatus = 'PARTIAL';
    p.present = false;
  } else {
    p.attendanceStatus = 'ABSENT';
    p.present = false;
  }
}

/* ───────────────────────── create ───────────────────────── */
async function createSession(opts = {}) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LiveClass = mongoose.model('LiveClass');
  const LiveRecording = mongoose.model('LiveRecording');
  const s = await settingsService.get();

  const courseTitle = opts.courseTitle || '';
  const batchName = opts.batchName || '';
  const title = opts.title || `${batchName || courseTitle || 'Live'} class`;
  const start = opts.scheduledStart ? new Date(opts.scheduledStart) : null;
  const durMin = opts.scheduledDurationMin || lmsConfig.meeting.defaultDurationMin || 60;
  const end = opts.scheduledEnd ? new Date(opts.scheduledEnd) : start ? new Date(start.getTime() + durMin * 60000) : null;

  const session = await LmsLiveSession.create({
    crmCourse: opts.crmCourse,
    batch: opts.batch,
    moodleCourseId: opts.moodleCourseId,
    recurrenceGroup: opts.recurrenceGroup,
    sessionIndex: opts.sessionIndex || 1,
    title,
    description: opts.description || '',
    courseTitle,
    batchName,
    teacherName: opts.teacherName || '',
    teacherCrmUser: opts.teacherCrmUser || undefined,
    scheduledStart: start || undefined,
    scheduledEnd: end || undefined,
    scheduledDurationMin: durMin,
    meetingProvider: lmsConfig.meeting.effectiveProvider,
    isMock: lmsConfig.meeting.effectiveProvider === 'mock',
    // a batch session shares the batch's persistent room; a one-off gets its own
    batchRoom: opts.batchRoom || undefined,
    roomName: opts.roomName || computeRoomName(courseTitle, batchName, title),
    publicKey: opts.publicKey || crypto.randomBytes(16).toString('hex'),
    recordingEnabled: s.recordingEnabled,
    recordingStatus: 'NOT_STARTED',
    status: 'scheduled',
    autoCreated: !!opts.autoCreated,
  });

  // No LiveRecording row yet — a batch's Mon-Fri/6-month schedule (see
  // recurrence.js) creates up to ~130 of these sessions up front, and most
  // will never actually happen (rescheduled, batch paused, etc). The row is
  // created lazily in startSession, only once a class actually goes live,
  // so the Recordings list isn't full of placeholders for classes that
  // haven't happened yet.

  try {
    const lc = await LiveClass.create({
      topic: title,
      course: courseTitle,
      batch: batchName,
      trainer: session.teacherName,
      scheduledAt: start || undefined,
      durationMin: durMin,
      mode: session.meetingProvider === 'bigbluebutton' ? 'Zoom' : 'In-person',
      status: 'Scheduled',
      // app deep link (authenticated Join button) — NOT a bearer-gated API URL,
      // which a plain browser click would 401 with jwtExpired.
      joinUrl: `${crmBase()}/#/lms/classes`,
      agenda: session.description,
      notes: `${TAG} auto room ${session.roomName} · ${session.meetingProvider}`,
    });
    session.liveClass = lc._id;
    await session.save();
    await LiveRecording.updateOne({ liveSession: session._id }, { $set: { liveClass: lc._id } });
  } catch (e) {
    /* non-fatal */
  }
  return session;
}

async function onBatchCreated(batchDoc) {
  return recurrence.generateForBatch(batchDoc, module.exports);
}

// explicit "regenerate the schedule" (deletes future un-started sessions first)
async function regenerateForBatch(batchId) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const Batch = mongoose.model('Batch');
  const batch = await Batch.findById(batchId);
  if (!batch) return { error: 404, message: 'Batch not found.' };
  await LmsLiveSession.updateMany(
    { batch: batch._id, status: { $in: ['scheduled', 'upcoming'] }, actualStart: { $exists: false } },
    { $set: { removed: true, status: 'cancelled' } }
  );
  const created = await recurrence.generateForBatch({ ...batch.toObject(), _id: batch._id }, module.exports, { force: true });
  return { result: { created: created.length } };
}

// Reschedule / edit a class time. Teacher or manager, only before it starts.
async function updateSchedule(id, admin, patch = {}) {
  const session = await loadFull(id);
  if (!session) return { error: 404, message: 'Live class not found.' };
  const role = await resolveRole(session, admin);
  if (role !== 'teacher') return { error: 403, message: 'Only the class teacher can edit the time.' };
  if (!['scheduled', 'upcoming'].includes(session.status)) {
    return { error: 409, message: `Cannot reschedule a class that is ${DISPLAY[session.status] || session.status}.` };
  }
  if (patch.title !== undefined) session.title = String(patch.title).slice(0, 200) || session.title;
  if (patch.description !== undefined) session.description = String(patch.description).slice(0, 2000);
  if (patch.autoStartAt !== undefined) session.autoStartAt = !!patch.autoStartAt;

  let start = session.scheduledStart;
  if (patch.scheduledStart) {
    const dt = new Date(patch.scheduledStart);
    if (Number.isNaN(dt.getTime())) return { error: 400, message: 'Invalid start time.' };
    start = dt;
    session.scheduledStart = dt;
  }
  if (patch.scheduledDurationMin !== undefined) {
    session.scheduledDurationMin = Math.max(5, Math.min(600, Number(patch.scheduledDurationMin) || 60));
  }
  if (patch.scheduledEnd) {
    const e = new Date(patch.scheduledEnd);
    if (!Number.isNaN(e.getTime())) session.scheduledEnd = e;
  } else if (start) {
    session.scheduledEnd = new Date(new Date(start).getTime() + session.scheduledDurationMin * 60000);
  }

  const gap = start ? new Date(start).getTime() - Date.now() : 999999999;
  session.status = gap <= 3600000 && gap > -60000 ? 'upcoming' : 'scheduled';
  session.updated = new Date();
  await session.save();

  await mongoose.model('LiveClass').updateOne(
    { _id: session.liveClass },
    { $set: { topic: session.title, scheduledAt: session.scheduledStart, durationMin: session.scheduledDurationMin, agenda: session.description, updated: new Date() } }
  );
  await mongoose.model('LiveRecording').updateOne({ liveSession: session._id }, { $set: { className: session.title } });
  return { result: safeView(session, 'teacher') };
}

// Add a student to a running batch: link/create the Student roster row, enrol
// into the Moodle course (if mapped), email them the class link + schedule.
async function addStudentToBatch({ batchId, email, name, crmUserId } = {}, admin) {
  const Batch = mongoose.model('Batch');
  const batch = await Batch.findById(batchId);
  if (!batch) return { error: 404, message: 'Batch not found.' };
  if (!isManager(admin)) {
    // a teacher can only add to their own batch
    if ((batch.trainer || '').toLowerCase() !== (admin.name || '').toLowerCase()) {
      return { error: 403, message: 'You can only add students to your own batch.' };
    }
  }
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!crmUserId && !/.+@.+\..+/.test(cleanEmail)) return { error: 400, message: 'A valid email (or crmUserId) is required.' };

  const Student = mongoose.model('Student');
  const Admin = mongoose.model('Admin');
  let studentDoc = null;
  let crmUser = null;

  if (crmUserId) crmUser = await Admin.findById(crmUserId);
  if (!crmUser && cleanEmail) crmUser = await Admin.findOne({ email: cleanEmail, removed: false });

  // roster row (Student model) — find by email (not batch+email, so a
  // student who already has a different batch gets MOVED, not duplicated),
  // create one only if they've never been seen before. Student.js's own
  // save hooks recount Batch.enrolled whenever `batch` changes, so there's
  // no manual increment to do here.
  studentDoc = cleanEmail ? await Student.findOne({ email: cleanEmail, removed: false }) : null;
  if (studentDoc) {
    if (studentDoc.batch !== batch.name) {
      studentDoc.batch = batch.name;
      studentDoc.course = batch.course || studentDoc.course;
      await studentDoc.save();
    }
  } else if (cleanEmail) {
    studentDoc = await new Student({
      name: name || (crmUser && crmUser.name) || cleanEmail.split('@')[0],
      email: cleanEmail,
      course: batch.course,
      batch: batch.name,
      status: 'Active',
      enrolledOn: new Date(),
      source: 'Counselor',
      notes: `${TAG} added mid-batch by ${admin.name || 'admin'}`,
    }).save();
  }

  // Moodle enrol (best-effort, only if the course is mapped + user provisionable)
  let moodleResult = null;
  const room = await ensureBatchRoom(batch);
  if (room.moodleCourseId && (crmUser || crmUserId)) {
    try {
      const { syncService } = require('./index');
      const Course = mongoose.model('Course');
      const course = batch.course ? await Course.findOne({ title: batch.course, removed: false }) : null;
      const uid = crmUser ? crmUser._id : crmUserId;
      await syncService.provisionUser(await Admin.findById(uid));
      if (course) {
        await syncService.enrolUser({ crmUserId: uid, crmCourseId: course._id, moodleCourseId: room.moodleCourseId, batchId: batch._id, roleShortname: 'student', source: 'batch' });
        moodleResult = 'enrolled';
      }
    } catch (e) {
      moodleResult = `deferred: ${e.message}`;
    }
  }

  // email them the batch class link + schedule
  const mailer = require('./mailer');
  const upcoming = await mongoose
    .model('LmsLiveSession')
    .find({ batch: batch._id, removed: false, status: { $in: ['scheduled', 'upcoming', 'live'] } })
    .sort({ scheduledStart: 1 })
    .limit(8)
    .lean();
  const mail = await mailer.sendBatchClassEmail([cleanEmail], {
    batchName: batch.name,
    courseTitle: batch.course,
    teacherName: batch.trainer,
    schedule: { days: batch.classDays, time: batch.classTime, durationMin: batch.classDurationMin, from: batch.startDate, to: room.validUntil },
    sessions: upcoming,
    joinPageUrl: `${crmBase()}/#/lms/classes`,
  });

  return {
    result: {
      studentId: studentDoc ? String(studentDoc._id) : null,
      email: cleanEmail || null,
      moodle: moodleResult,
      emailed: mail.sent > 0,
      roomValidUntil: room.validUntil,
    },
  };
}

// Search BOTH student pools — the LMS `Student` roster (ops/CRM rows: fees,
// progress, counselor, …) and `Admin` accounts with role Student (real
// login accounts, from User Management) — merged into one deduped-by-email
// list, so a "who do I add to this batch" picker never misses either kind.
async function searchStudents(q, limit = 20) {
  const term = String(q || '').trim();
  if (term.length < 2) return { result: [] };
  const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const Student = mongoose.model('Student');
  const Admin = mongoose.model('Admin');

  const [rosterRows, accountRows] = await Promise.all([
    Student.find({ removed: false, $or: [{ name: rx }, { email: rx }] })
      .select('name email batch')
      .limit(limit)
      .lean(),
    Admin.find({ removed: false, role: { $in: LMS_STUDENT_ROLES }, $or: [{ name: rx }, { email: rx }] })
      .select('name email')
      .limit(limit)
      .lean(),
  ]);

  const byEmail = new Map();
  for (const r of rosterRows) {
    const email = String(r.email || '').toLowerCase();
    if (!email) continue;
    byEmail.set(email, { studentId: String(r._id), crmUserId: null, name: r.name, email, currentBatch: r.batch || null, source: 'roster' });
  }
  for (const a of accountRows) {
    const email = String(a.email || '').toLowerCase();
    if (!email) continue;
    const existing = byEmail.get(email);
    if (existing) {
      existing.crmUserId = String(a._id);
      existing.source = 'both';
    } else {
      byEmail.set(email, { studentId: null, crmUserId: String(a._id), name: a.name, email, currentBatch: null, source: 'account' });
    }
  }
  return { result: Array.from(byEmail.values()).slice(0, limit) };
}

// A batch's current roster — merges the `Student` roster (matched by batch
// name) with `LmsEnrolment` (the proper `Admin`↔`Batch` ref), deduped by
// email, since neither pool alone is authoritative today.
async function listBatchStudents(batchId) {
  const Batch = mongoose.model('Batch');
  const batch = await Batch.findById(batchId);
  if (!batch) return { error: 404, message: 'Batch not found.' };

  const Student = mongoose.model('Student');
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const [rosterRows, enrolments] = await Promise.all([
    Student.find({ batch: batch.name, removed: false }).select('name email status progress attendancePct').lean(),
    LmsEnrolment.find({ batch: batchId, status: { $ne: 'ended' } }).populate('crmUser', 'name email').lean(),
  ]);

  const byEmail = new Map();
  for (const r of rosterRows) {
    const email = String(r.email || '').toLowerCase();
    if (!email) continue;
    byEmail.set(email, {
      id: String(r._id), crmUserId: null, name: r.name, email,
      status: r.status, progress: r.progress || 0, attendancePct: r.attendancePct || 0, source: 'roster',
    });
  }
  for (const e of enrolments) {
    if (!e.crmUser) continue;
    const email = String(e.crmUser.email || '').toLowerCase();
    if (!email) continue;
    const existing = byEmail.get(email);
    if (existing) {
      existing.crmUserId = String(e.crmUser._id);
      existing.source = 'both';
    } else {
      byEmail.set(email, {
        id: null, crmUserId: String(e.crmUser._id), name: e.crmUser.name, email,
        status: e.status, progress: e.progressPct || 0, attendancePct: 0, source: 'account',
      });
    }
  }
  return { result: Array.from(byEmail.values()) };
}

// Un-assign a student from a batch — clears the roster row's `batch` (keeps
// the row itself) and ends the matching LmsEnrolment, if any.
async function removeStudentFromBatch({ batchId, studentId, crmUserId, email } = {}, admin) {
  const Batch = mongoose.model('Batch');
  const batch = await Batch.findById(batchId);
  if (!batch) return { error: 404, message: 'Batch not found.' };
  if (!isManager(admin) && (batch.trainer || '').toLowerCase() !== (admin.name || '').toLowerCase()) {
    return { error: 403, message: 'You can only manage your own batch.' };
  }

  const Student = mongoose.model('Student');
  const cleanEmail = String(email || '').trim().toLowerCase();
  let removed = false;

  const studentDoc = studentId
    ? await Student.findById(studentId)
    : cleanEmail
    ? await Student.findOne({ batch: batch.name, email: cleanEmail, removed: false })
    : null;
  if (studentDoc && studentDoc.batch === batch.name) {
    studentDoc.batch = '';
    await studentDoc.save();
    removed = true;
  }

  if (crmUserId) {
    const LmsEnrolment = mongoose.model('LmsEnrolment');
    const res = await LmsEnrolment.updateMany({ batch: batchId, crmUser: crmUserId }, { $set: { status: 'ended' } });
    if (res.modifiedCount) removed = true;
  }

  if (removed) {
    // studentDoc.save() above already recounts via Student.js's own hooks
    // when a roster row was touched — this also covers the LmsEnrolment
    // -only case (crmUserId given but no matching roster row) and is a
    // harmless no-op recount otherwise (it sets the true count, not a delta).
    const { studentAccountService } = require('./index');
    await studentAccountService.syncBatchEnrolledCounts([batch.name]).catch(() => {});
  }
  return { result: { removed } };
}

/* ───────────────────────── provider room ───────────────────────── */
async function loadFull(id) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const doc = await LmsLiveSession.findById(id).select(
    '+moderatorPW +attendeePW +providerData +joinTickets +videoUrl +handledWebhookEvents'
  );
  return coerceLegacy(doc);
}

/* ─────────────── per-batch persistent room (same link ≥ 6 months) ─────────────── */
async function ensureBatchRoom(batchDoc) {
  const LmsBatchRoom = mongoose.model('LmsBatchRoom');
  const Course = mongoose.model('Course');
  const MoodleObjectMap = mongoose.model('MoodleObjectMap');
  const Admin = mongoose.model('Admin');

  let room = await LmsBatchRoom.findOne({ batch: batchDoc._id });
  if (room && !room.removed) return room;

  const course = batchDoc.course ? await Course.findOne({ title: batchDoc.course, removed: false }) : null;
  const courseMap = course ? await MoodleObjectMap.findOne({ kind: 'course', crmId: course._id }) : null;
  const teacher = batchDoc.trainer
    ? await Admin.findOne({ name: new RegExp(`^${String(batchDoc.trainer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), removed: false })
    : null;

  const from = new Date();
  const minUntil = new Date(from);
  minUntil.setMonth(minUntil.getMonth() + (lmsConfig.meeting.minBatchMonths || 6));
  const endDate = batchDoc.endDate ? new Date(batchDoc.endDate) : null;
  const validUntil = endDate && endDate > minUntil ? endDate : minUntil;

  room = await LmsBatchRoom.create({
    batch: batchDoc._id,
    batchName: batchDoc.name,
    courseTitle: batchDoc.course || (course && course.title) || '',
    crmCourse: course ? course._id : undefined,
    moodleCourseId: courseMap ? courseMap.moodleId : undefined,
    teacherName: batchDoc.trainer || '',
    teacherCrmUser: teacher ? teacher._id : undefined,
    provider: lmsConfig.meeting.effectiveProvider,
    roomName: computeBatchRoomName(batchDoc.course || (course && course.title) || '', batchDoc.name),
    publicKey: crypto.randomBytes(16).toString('hex'),
    validFrom: from,
    validUntil,
  });
  return room;
}
async function ensureProviderRoom(session) {
  const provider = getMeetingProvider();
  if (session.meetingProvider !== provider.name) {
    session.meetingProvider = provider.name;
    session.isMock = provider.name === 'mock';
  }
  const s = await settingsService.get();

  // A session that belongs to a batch uses the batch's ONE persistent room —
  // same meetingId / passwords for every class of the batch.
  if (session.batch) {
    const LmsBatchRoom = mongoose.model('LmsBatchRoom');
    const Batch = mongoose.model('Batch');
    let room = session.batchRoom ? await LmsBatchRoom.findById(session.batchRoom).select('+moderatorPW +attendeePW +providerData') : null;
    if (!room) {
      const batchDoc = await Batch.findById(session.batch);
      room = batchDoc ? await ensureBatchRoom(batchDoc) : null;
      if (room) room = await LmsBatchRoom.findById(room._id).select('+moderatorPW +attendeePW +providerData');
    }
    if (room) {
      // re-provision if the provider changed (e.g. mock -> bigbluebutton once
      // BBB is configured) so the batch's link becomes a real room.
      const providerChanged = !!room.provider && room.provider !== provider.name;
      room.provider = provider.name;
      if (providerChanged) {
        room.meetingId = undefined;
        room.providerRoomCreated = false;
      }
      // The mock provider's "room" is just a label — create it once ever.
      // A real provider (BBB) needs ensureRoom() called again for EVERY
      // class, not just the batch's first one: BBB's `create` call is what
      // actually opens today's occurrence of the meeting (idempotent if
      // it's already running) — skipping it after the first class meant
      // every later class tried to `join` a meeting that was never
      // (re)started, which BBB rejects outright once that meetingID has
      // ever been explicitly ended ("You can not join a meeting that has
      // already been forcibly ended"). Same meetingId/passwords are reused
      // every time (passed in below) so the batch's link stays constant.
      const needsCreate = provider.name === 'mock' ? !room.providerRoomCreated : true;
      if (needsCreate) {
        const created = await provider.ensureRoom(
          { _id: room._id, meetingId: room.meetingId, roomName: room.roomName, title: room.batchName, courseTitle: room.courseTitle, batchName: room.batchName, teacherName: room.teacherName, scheduledEnd: room.validUntil, publicKey: room.publicKey, moderatorPW: room.moderatorPW, attendeePW: room.attendeePW },
          { record: session.recordingEnabled && s.recordingAutoStart }
        );
        room.meetingId = created.meetingId || room.meetingId || room.roomName;
        if (created.roomName) room.roomName = created.roomName;
        if (created.moderatorPW) room.moderatorPW = created.moderatorPW;
        if (created.attendeePW) room.attendeePW = created.attendeePW;
        if (created.providerData) room.providerData = created.providerData;
        room.providerRoomCreated = true;
        room.updated = new Date();
        await room.save();
      }
      // point the session at the shared room
      session.batchRoom = room._id;
      session.meetingId = room.meetingId;
      session.roomName = room.roomName;
      session.publicKey = room.publicKey;
      session.moderatorPW = room.moderatorPW;
      session.attendeePW = room.attendeePW;
      session.providerData = room.providerData;
      return session;
    }
  }

  // no batch — per-session room (manual one-off classes)
  if (session.meetingId && session.meetingProvider !== 'mock') return session;
  const room = await provider.ensureRoom(session, { record: session.recordingEnabled && s.recordingAutoStart });
  session.meetingId = room.meetingId || session.meetingId || session.roomName;
  if (room.roomName) session.roomName = room.roomName;
  if (room.moderatorPW) session.moderatorPW = room.moderatorPW;
  if (room.attendeePW) session.attendeePW = room.attendeePW;
  if (room.providerData) session.providerData = room.providerData;
  return session;
}

/* ───────────────────────── lifecycle ───────────────────────── */
async function mirrorLiveClass(session, status, extra = {}) {
  emitLiveState(session);
  if (!session.liveClass) return;
  await mongoose.model('LiveClass').updateOne(
    { _id: session.liveClass },
    { $set: { status, updated: new Date(), ...extra } }
  );
}

// real-time nudge — panels listening on 'lms:liveclass' refresh their lists.
// No-op on Vercel serverless (no persistent socket); panels also poll.
function emitLiveState(session) {
  try {
    require('./realtime').broadcast('lms:liveclass', {
      id: String(session._id),
      status: DISPLAY[session.status] || session.status,
      lifecycle: session.status,
      title: session.title,
      course: session.courseTitle,
      batch: session.batchName,
    });
  } catch (e) {
    /* noop */
  }
}

async function startSession(id, admin, { auto = false } = {}) {
  const session = await loadFull(id);
  if (!session) return { error: 404, message: 'Live class not found.' };
  if (!auto) {
    const role = await resolveRole(session, admin);
    if (role !== 'teacher') return { error: 403, message: 'Only the class teacher can start it.' };
  }
  // recording_processing/available is the normal post-end state (any class
  // with recording enabled — the default — goes through it, not 'ended';
  // see endSession). Still resumable for as long as the scheduled window is
  // open, same as 'ended' below — a class shouldn't become permanently
  // unjoinable just because someone left early and it wrapped up recording.
  if (['recording_processing', 'recording_available'].includes(session.status) && !withinScheduledWindow(session)) {
    return { error: 409, message: 'This class has already ended and its recording is being processed.' };
  }
  if (session.status === 'ended' && !withinScheduledWindow(session)) {
    return { error: 409, message: 'This class has already ended.' };
  }
  const s = await settingsService.get();

  session.status = 'starting';
  await session.save();
  try {
    await ensureProviderRoom(session);
  } catch (e) {
    session.status = session.actualStart ? 'live' : 'scheduled';
    await session.save();
    return { error: 502, message: 'Could not start the meeting. Try again shortly.' };
  }

  session.status = 'live';
  session.actualStart = session.actualStart || new Date();
  // Guard only 'AVAILABLE' so resuming doesn't clobber a recording that
  // already finished processing. 'PROCESSING' does NOT skip this: resuming
  // means BBB starts recording a new segment too (ensureProviderRoom passes
  // record:true on every (re)create), so recordingStatus goes back to
  // RECORDING — otherwise the next endSession finds recordingStatus still
  // 'PROCESSING' (never 'RECORDING'), falls through to plain 'ended'
  // instead of 'recording_processing', and pollRecordings (which only
  // looks at 'recording_processing' sessions) never checks this one again.
  if (session.recordingEnabled && s.recordingAutoStart && session.recordingStatus !== 'AVAILABLE') {
    session.recordingStatus = 'RECORDING';
    // Created here (upsert), not when the session/schedule was generated —
    // only classes that actually go live get a recording row at all.
    const rec = await mongoose.model('LiveRecording').findOneAndUpdate(
      { liveSession: session._id },
      {
        $set: { status: 'RECORDING', startedAt: new Date(), meetingId: session.meetingId, provider: session.meetingProvider },
        $setOnInsert: {
          crmCourse: session.crmCourse,
          batch: session.batch,
          teacherCrmUser: session.teacherCrmUser,
          courseTitle: session.courseTitle,
          batchName: session.batchName,
          teacherName: session.teacherName,
          className: session.title,
          liveClass: session.liveClass,
        },
      },
      { upsert: true, new: true }
    );
    session.recording = rec._id;
  }
  session.updated = new Date();
  await session.save();
  await mirrorLiveClass(session, 'Live');
  return { result: safeView(session, auto ? 'system' : 'teacher') };
}

async function endSession(id, admin, { auto = false } = {}) {
  const session = await loadFull(id);
  if (!session) return { error: 404, message: 'Live class not found.' };
  if (!auto) {
    const role = await resolveRole(session, admin);
    if (role !== 'teacher') return { error: 403, message: 'Only the class teacher can end it.' };
  }
  if (['ended', 'recording_processing', 'recording_available'].includes(session.status)) {
    return { result: safeView(session, 'teacher') };
  }
  const s = await settingsService.get();

  session.status = 'ending';
  session.autoEnded = !!auto;
  await session.save();

  const provider = getMeetingProvider();
  try {
    await provider.endRoom(session);
  } catch (e) {
    /* best-effort */
  }

  const now = new Date();
  session.actualEnd = now;

  // finalise attendance
  let present = 0;
  for (const p of session.participants) {
    if (p.online) closeInterval(p, now, 'reconcile');
    recompute(p, session, s);
    if (p.present) present += 1;
    await writeAttendanceMirror(session, p);
  }

  // recording -> processing / available
  const recDurationMin = Math.max(0, Math.round((now - new Date(session.actualStart || now)) / 60000));
  if (session.recordingEnabled && session.recordingStatus === 'RECORDING') {
    const RecModel = mongoose.model('LiveRecording');
    if (session.meetingProvider === 'bigbluebutton') {
      session.recordingStatus = 'PROCESSING';
      session.status = 'recording_processing';
      await RecModel.updateOne(
        { liveSession: session._id },
        { $set: { status: 'PROCESSING', endedAt: now, durationMin: recDurationMin } }
      );
    } else {
      // mock (or any legacy non-BBB session): the provider itself never
      // produces a recording file — this always waits on the teacher's
      // manual upload (liveScope.uploadRecording) rather than ever claiming
      // AVAILABLE with nothing behind it, which is what silently left
      // students with a "recording" row that had no video to play.
      // AWAITING_UPLOAD (not PROCESSING — that's reserved for the
      // compression step right after an actual upload) so the Recordings
      // page's "Upload recording" button doesn't hide itself the moment
      // the class ends, before the teacher has uploaded anything.
      session.recordingStatus = 'PROCESSING';
      session.status = 'recording_processing';
      await RecModel.updateOne(
        { liveSession: session._id },
        { $set: { status: 'AWAITING_UPLOAD', endedAt: now, durationMin: recDurationMin } }
      );
    }
  } else {
    session.status = 'ended';
  }

  // progress contribution (configurable; default off)
  const bumped = [];
  if (s.attendanceCountsToProgress && s.liveClassProgressWeightPct > 0 && session.moodleCourseId) {
    const LmsEnrolment = mongoose.model('LmsEnrolment');
    for (const p of session.participants.filter((x) => x.role === 'student' && x.present)) {
      const enr = await LmsEnrolment.findOne({ crmUser: p.crmUser, moodleCourseId: session.moodleCourseId });
      if (enr) {
        enr.progressPct = Math.min(100, (enr.progressPct || 0) + s.liveClassProgressWeightPct);
        enr.lastActivityAt = now;
        await enr.save();
        bumped.push({ crmUser: String(p.crmUser), progressPct: enr.progressPct });
      }
    }
  }
  session.progressApplied = bumped.length > 0;
  session.updated = now;
  await session.save();
  await mirrorLiveClass(session, 'Completed', { attendedCount: present, registeredCount: session.participants.length });

  return {
    result: {
      ...safeView(session, 'teacher'),
      attendees: attendanceRows(session),
      progressWriteback: { applied: bumped.length > 0, weightPct: s.liveClassProgressWeightPct, bumped },
    },
  };
}

async function writeAttendanceMirror(session, p) {
  const AttendanceRecord = mongoose.model('AttendanceRecord');
  const map = { PRESENT: 'Present', LATE: 'Late', PARTIAL: 'Late', ABSENT: 'Absent', EXCUSED: 'Excused' };
  await AttendanceRecord.findOneAndUpdate(
    { student: p.name, sessionTopic: session.title, date: session.actualStart || session.scheduledStart || session.created },
    {
      $set: {
        student: p.name,
        batch: session.batchName,
        course: session.courseTitle,
        sessionTopic: session.title,
        date: session.actualStart || session.scheduledStart || session.created || new Date(),
        status: map[p.attendanceStatus] || 'Absent',
        joinTime: p.firstJoinAt ? new Date(p.firstJoinAt).toISOString().slice(11, 16) : undefined,
        leaveTime: p.lastLeftAt ? new Date(p.lastLeftAt).toISOString().slice(11, 16) : undefined,
        durationMin: p.totalDurationMin || 0,
        markedBy: 'Auto',
        remarks: `${TAG} ${session.meetingProvider} · ${p.attendancePct}% · joins ${p.joinCount}`,
        updated: new Date(),
      },
    },
    { upsert: true }
  );
}

/* ───────────────────────── join ───────────────────────── */
async function issueJoin(id, admin) {
  const session = await loadFull(id);
  if (!session) return { error: 404, message: 'Live class not found.' };
  const role = await resolveRole(session, admin);
  if (!role) return { error: 403, message: 'You are not a participant of this class.' };

  // A class marked 'ended' OR 'recording_processing'/'recording_available'
  // (early End click, the teacher's own connection dropping, or the
  // auto-lifecycle tick firing a touch ahead of schedule) resumes for as
  // long as the batch's scheduled time is still running
  // (withinScheduledWindow). recording_processing is the NORMAL post-end
  // state for any class with recording on (the default — see endSession),
  // not just an edge case, so it needs the same resume path 'ended' gets.
  // `auto: true` skips startSession's teacher-only check since this isn't a
  // fresh "start the class" decision, just resuming a slot that was already
  // live.
  //
  // Only the TEACHER can actually trigger the resume (re-opens the BBB room
  // and re-arms recording — see ensureProviderRoom/startSession): a student
  // clicking Join first shouldn't be able to spin the meeting back up on
  // their own, since recording is meant to track the teacher's presence,
  // not run unattended for whoever happens to click first.
  const resumableStatuses = ['ended', 'recording_processing', 'recording_available'];
  if (resumableStatuses.includes(session.status) && withinScheduledWindow(session)) {
    if (role !== 'teacher') {
      return { error: 409, message: 'Waiting for the teacher to rejoin the class.' };
    }
    const started = await startSession(id, admin, { auto: true });
    if (started.error) return started;
    return issueJoin(id, admin); // re-load now-live session
  }
  if (role === 'teacher' && ['scheduled', 'upcoming'].includes(session.status)) {
    const started = await startSession(id, admin);
    if (started.error) return started;
    return issueJoin(id, admin); // re-load now-live session
  }
  if (session.status !== 'live') {
    return { error: 409, message: role === 'student' ? 'The class has not started yet.' : 'Class is not live.' };
  }
  // Re-sync against the batch room whenever the session's stored provider
  // is stale relative to the currently configured one (e.g. a session was
  // started back when the effective provider still resolved to 'mock', and
  // only later got switched over to a real provider like BigBlueButton) —
  // not just when meetingId is completely empty. Joining with a stale
  // meetingId/provider pair is exactly how BBB's "You can not join a
  // meeting that has already been forcibly ended" surfaces: the join URL
  // gets built against an ID that was never (re)created under the room's
  // current provider.
  {
    const activeProvider = getMeetingProvider();
    if (activeProvider.name !== 'mock' && (!session.meetingId || session.meetingProvider !== activeProvider.name)) {
      await ensureProviderRoom(session);
    }
  }

  const now = new Date();
  let p = session.participants.find((x) => String(x.crmUser) === String(admin._id));
  if (!p) {
    session.participants.push({
      crmUser: admin._id,
      name: `${admin.name || ''} ${admin.surname || ''}`.trim() || admin.email,
      email: admin.email,
      role: role === 'teacher' ? 'teacher' : 'student',
    });
    p = session.participants[session.participants.length - 1];
  }
  // provider webhooks are authoritative when present; the CRM interval is a
  // fallback that merge() will fold in without double-counting.
  openInterval(p, now, 'crm');
  const s = await settingsService.get();
  recompute(p, session, s);

  const ticket = crypto.randomBytes(20).toString('hex');
  session.joinTickets = (session.joinTickets || []).filter((t) => !t.used && t.exp > now).slice(-30);
  session.joinTickets.push({
    ticket,
    crmUser: admin._id,
    role: role === 'teacher' ? 'moderator' : 'viewer',
    exp: new Date(now.getTime() + lmsConfig.meeting.joinTicketTtlSec * 1000),
    used: false,
  });
  session.updated = now;
  await session.save();
  await writeAttendanceMirror(session, p);

  return {
    result: { role, url: `${crmBase()}/api/lms/live/t/${ticket}`, expiresInSec: lmsConfig.meeting.joinTicketTtlSec },
  };
}

async function redeemTicket(ticketStr) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const now = new Date();
  const session = await LmsLiveSession.findOne({ 'joinTickets.ticket': ticketStr }).select(
    '+moderatorPW +attendeePW +providerData +joinTickets +videoUrl'
  );
  if (!session) return { error: 404, message: 'Invalid join link.' };
  const t = session.joinTickets.find((x) => x.ticket === ticketStr);
  if (!t || t.used || t.exp < now) return { error: 410, message: 'This join link has expired — click Join again.' };
  t.used = true;
  await session.save();

  const user = await mongoose.model('Admin').findById(t.crmUser);
  const provider = getMeetingProvider();
  const opts = {
    role: t.role === 'moderator' ? 'moderator' : 'viewer',
    fullName: user ? `${user.name || ''} ${user.surname || ''}`.trim() || user.email : 'Guest',
    email: user ? user.email : '',
    userId: String(t.crmUser),
  };

  const url = await provider.getJoinUrl(session, opts);
  return { result: { url } };
}

async function recordLeave(id, crmUserId, source = 'crm') {
  const session = await loadFull(id);
  if (!session) return { error: 404, message: 'Live class not found.' };
  const p = session.participants.find((x) => String(x.crmUser) === String(crmUserId));
  if (!p) return { result: { ok: true } };
  closeInterval(p, new Date(), source);
  const s = await settingsService.get();
  recompute(p, session, s);
  await session.save();
  await writeAttendanceMirror(session, p);
  return { result: { left: p.name, totalDurationMin: p.totalDurationMin, attendanceStatus: p.attendanceStatus } };
}

/* ───────────────────────── BBB webhook ───────────────────────── */
// evt: { id, type, meetingId, userId, userName, crmUserId?, recordId?, at }
async function handleBbbEvent(evt) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  // A batch's classes all share one meetingId (the persistent room), so a
  // webhook maps to the session that is currently LIVE in that room; fall back
  // to the most recent one.
  const sel = '+handledWebhookEvents +moderatorPW +attendeePW';
  let session =
    (await LmsLiveSession.findOne({ meetingId: evt.meetingId, status: { $in: ['starting', 'live', 'ending'] } })
      .sort({ actualStart: -1 })
      .select(sel)) ||
    (await LmsLiveSession.findOne({ meetingId: evt.meetingId }).sort({ actualStart: -1, scheduledStart: -1 }).select(sel));
  if (!session) return { ok: true, ignored: 'no matching session' };
  if (evt.id && (session.handledWebhookEvents || []).includes(evt.id)) return { ok: true, duplicate: true };

  const s = await settingsService.get();
  const at = evt.at ? new Date(evt.at) : new Date();

  const findByProviderUser = () =>
    session.participants.find(
      (p) => p.sessions.some((x) => x.providerUserId === String(evt.userId)) || String(p.crmUser) === String(evt.crmUserId)
    );

  switch (evt.type) {
    case 'meeting-started':
      if (session.status !== 'live') {
        session.status = 'live';
        session.actualStart = session.actualStart || at;
      }
      break;
    case 'meeting-ended':
      if (!['ended', 'recording_processing', 'recording_available'].includes(session.status)) {
        await session.save();
        return endSession(session._id, null, { auto: true });
      }
      break;
    case 'user-joined': {
      let p = findByProviderUser();
      if (!p && evt.crmUserId) {
        const u = await mongoose.model('Admin').findById(evt.crmUserId);
        session.participants.push({
          crmUser: evt.crmUserId,
          name: evt.userName || (u && u.name) || 'Participant',
          email: u && u.email,
          role: evt.role === 'MODERATOR' ? 'teacher' : 'student',
        });
        p = session.participants[session.participants.length - 1];
      }
      if (!p) {
        // unknown participant — track by name only
        session.participants.push({ name: evt.userName || 'Participant', role: 'observer' });
        p = session.participants[session.participants.length - 1];
      }
      const open = openInterval(p, at, 'bbb', String(evt.userId));
      open.providerUserId = String(evt.userId);
      recompute(p, session, s);
      break;
    }
    case 'user-left':
    case 'participant-disconnected': {
      const p = findByProviderUser();
      if (p) {
        closeInterval(p, at, 'bbb');
        recompute(p, session, s);
      }
      break;
    }
    case 'recording-ready':
    case 'recording-available': {
      await applyRecordingReady(session, { recordingId: evt.recordId, playbackUrl: evt.playbackUrl, durationMin: evt.durationMin });
      break;
    }
    case 'recording-failed':
    case 'meeting-error': {
      session.recordingStatus = 'FAILED';
      await mongoose.model('LiveRecording').updateOne(
        { liveSession: session._id },
        { $set: { status: 'FAILED', failReason: evt.reason || evt.type } }
      );
      break;
    }
    default:
      break;
  }

  if (evt.id) {
    session.handledWebhookEvents = [...(session.handledWebhookEvents || []).slice(-200), evt.id];
  }
  session.updated = new Date();
  await session.save();
  return { ok: true };
}

async function applyRecordingReady(session, { recordingId, playbackUrl, downloadUrl, durationMin }) {
  const RecModel = mongoose.model('LiveRecording');
  session.recordingStatus = 'AVAILABLE';
  session.status = 'recording_available';
  // Same "students see it 2h after the class ended" delay as the manual
  // -upload path (liveScope.uploadRecording) — this was only ever wired
  // into that path, so a BBB-recorded class (the common case now) was
  // skipping it entirely and going straight to visible-immediately.
  const RECORDING_STUDENT_DELAY_MS = 2 * 60 * 60 * 1000;
  const now = new Date();
  const earliestForStudents = session.actualEnd ? new Date(new Date(session.actualEnd).getTime() + RECORDING_STUDENT_DELAY_MS) : now;
  const publishedAt = earliestForStudents > now ? earliestForStudents : now;
  await RecModel.updateOne(
    { liveSession: session._id },
    {
      $set: {
        status: 'AVAILABLE',
        recordingId: recordingId || undefined,
        playbackUrl: playbackUrl || undefined,
        downloadUrl: downloadUrl || undefined,
        durationMin: durationMin || undefined,
        publishedAt,
        updated: new Date(),
      },
    }
  );
  session.notifiedRecording = false; // let the notifier pick it up
}

/* ───────────────────────── background ticks ───────────────────────── */
async function autoLifecycleTick() {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const s = await settingsService.get();
  const now = new Date();

  // scheduled -> upcoming (within 1h of start)
  await LmsLiveSession.updateMany(
    { removed: false, status: 'scheduled', scheduledStart: { $lte: new Date(now.getTime() + 3600000), $gt: now } },
    { $set: { status: 'upcoming' } }
  );

  // auto-start — global "at-schedule" policy OR the per-class autoStartAt flag
  const dueQ = {
    removed: false,
    status: { $in: ['scheduled', 'upcoming'] },
    scheduledStart: { $lte: now },
    $or: [{ scheduledEnd: { $gt: now } }, { scheduledEnd: { $exists: false } }, { scheduledEnd: null }],
  };
  if (s.autoStartPolicy !== 'at-schedule') dueQ.autoStartAt = true;
  const due = await LmsLiveSession.find(dueQ).limit(10);
  for (const d of due) await startSession(d._id, null, { auto: true }).catch(() => {});

  // auto-end (schedule-based) — the class's scheduled window is over.
  if (s.autoEndPolicy !== 'manual') {
    const graceMs = (s.autoEndPolicy === 'grace' ? s.autoEndGraceMin : 0) * 60000;
    const overdue = await LmsLiveSession.find({
      removed: false,
      status: 'live',
      scheduledEnd: { $lt: new Date(now.getTime() - graceMs) },
    }).limit(10);
    for (const d of overdue) await endSession(d._id, null, { auto: true }).catch(() => {});
  }

  // auto-end (BBB-actually-ended) — a teacher who leaves via BBB's own UI
  // (closing the tab) rather than the CRM's "End class" button leaves the
  // session stuck 'live' — nothing tells the CRM the meeting is over until
  // the scheduled window lapses, which could be hours later. BBB itself
  // knows immediately (its own meeting ends when the last participant
  // leaves), so ask it directly for still-'live' sessions instead of only
  // trusting the clock.
  const provider = getMeetingProvider();
  if (provider.name === 'bigbluebutton') {
    // Grace period before trusting isRunning===false: BBB's create doesn't
    // guarantee isMeetingRunning flips true instantly, and a session sits
    // 'live' for the seconds between the teacher clicking Start and actually
    // joining — checking too early would end classes before anyone got in.
    // 5 minutes is ample startup slack while still catching a "closed the
    // BBB tab" abandonment well before the scheduled-time fallback above.
    const bbbGraceCutoff = new Date(now.getTime() - 5 * 60000);
    const stillLive = await LmsLiveSession.find({
      removed: false,
      status: 'live',
      meetingProvider: 'bigbluebutton',
      actualStart: { $lt: bbbGraceCutoff },
    })
      .select('+moderatorPW +attendeePW +providerData')
      .limit(20);
    for (const d of stillLive) {
      const running = await provider.isRunning(d).catch(() => null);
      if (running === false) await endSession(d._id, null, { auto: true }).catch(() => {});
    }

    // auto-end (teacher left, students didn't) — recording is meant to
    // track the teacher's presence, not run unattended for whoever's still
    // in the room, so a meeting with no moderator left but students still
    // connected gets ended (which stops/finalizes the recording) the same
    // as a fully-empty one. Its own shorter grace period (vs. the 5-minute
    // one above) still gives the teacher's own join a moment to finish its
    // handshake right after Start before this looks for them.
    const modGraceCutoff = new Date(now.getTime() - 2 * 60000);
    const liveNeedingModCheck = await LmsLiveSession.find({
      removed: false,
      status: 'live',
      meetingProvider: 'bigbluebutton',
      actualStart: { $lt: modGraceCutoff },
    })
      .select('+moderatorPW +attendeePW +providerData')
      .limit(20);
    for (const d of liveNeedingModCheck) {
      const participants = await provider.getParticipants(d).catch(() => null);
      if (!participants || participants.length === 0) continue; // covered by the isRunning check above
      const hasModerator = participants.some((p) => p.role === 'MODERATOR');
      if (!hasModerator) await endSession(d._id, null, { auto: true }).catch(() => {});
    }
  }
}

async function pollRecordings() {
  const provider = getMeetingProvider();
  if (provider.name !== 'bigbluebutton') return;
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const pending = await LmsLiveSession.find({
    removed: false,
    status: 'recording_processing',
    meetingId: { $exists: true },
  }).select('+moderatorPW +attendeePW').limit(20);
  const LiveRecording = mongoose.model('LiveRecording');
  for (const session of pending) {
    try {
      const recs = await provider.getRecordings(session);
      if (!recs || !recs.length) continue;
      // Every class in a batch shares one BBB meetingID (the persistent
      // batch room — see ensureProviderRoom), so getRecordings() here
      // returns every recording ever made in that room, not just this
      // occurrence's. Timing is the only thing that tells them apart: a
      // recording belongs to THIS session if it started at/after this
      // session's actualStart (small grace for clock skew), and isn't
      // already claimed by a different session in the same room.
      const sessionStart = session.actualStart ? new Date(session.actualStart).getTime() : 0;
      const recordIds = recs.map((r) => r.recordID).filter(Boolean);
      const claimedElsewhere = new Set(
        (await LiveRecording.find({ recordingId: { $in: recordIds }, liveSession: { $ne: session._id } }, 'recordingId').lean()).map(
          (r) => r.recordingId
        )
      );
      const candidates = recs.filter((r) => r.recordID && !claimedElsewhere.has(r.recordID) && (!r.startTime || r.startTime >= sessionStart - 60000));
      const ready = candidates.find((r) => r.state === 'published' || r.published);
      if (ready) {
        await applyRecordingReady(session, {
          recordingId: ready.recordID,
          playbackUrl: ready.playbackUrl,
          durationMin: ready.durationMin,
        });
        await session.save();
      }
    } catch (e) {
      /* keep polling */
    }
  }
}

/* ───────────────────────── roles / reads ───────────────────────── */
async function resolveRole(session, admin) {
  if (!admin) return null;
  if (session.teacherCrmUser && String(session.teacherCrmUser) === String(admin._id)) return 'teacher';
  if (session.teacherName && admin.name && session.teacherName.toLowerCase() === admin.name.toLowerCase()) return 'teacher';
  // Sessions snapshot teacherName/teacherCrmUser once, at batch-creation
  // time (recurrence.js), and never get refreshed if the batch's Trainer is
  // edited afterward — so a batch created before Trainer became a real
  // Teacher-account picker (or just re-assigned to someone else) leaves its
  // already-generated sessions pointing at the old/blank value forever.
  // Falling back to the batch's CURRENT trainer keeps this self-healing
  // instead of needing a one-off data migration.
  if (session.batch && admin.name) {
    const Batch = mongoose.model('Batch');
    const batch = await Batch.findById(session.batch).select('trainer').lean();
    if (batch && batch.trainer && batch.trainer.toLowerCase() === admin.name.toLowerCase()) return 'teacher';
  }
  if (isManager(admin)) return 'teacher';
  if (session.participants.some((p) => String(p.crmUser) === String(admin._id))) return 'student';
  if (session.moodleCourseId) {
    const enr = await mongoose.model('LmsEnrolment').findOne({ crmUser: admin._id, moodleCourseId: session.moodleCourseId });
    if (enr) return enr.roleShortname === 'editingteacher' ? 'teacher' : 'student';
  }
  // Same roster-batch match the Student Dashboard already uses (panel.js's
  // studentDashboard) — without this, a student who has never joined a
  // class yet (no participant row) and has no Moodle enrolment record
  // (Moodle sync not configured, or not yet run) never resolves to
  // 'student' here, so "My Classes" shows nothing and there is no Join
  // button to click at all.
  if (session.batchName && admin.email) {
    const Student = mongoose.model('Student');
    const emailRx = new RegExp(`^${String(admin.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const onRoster = await Student.exists({ removed: false, email: emailRx, batch: session.batchName });
    if (onRoster) return 'student';
  }
  return null;
}

function attendanceRows(session) {
  return session.participants.map((p) => ({
    name: p.name,
    email: p.email,
    role: p.role,
    firstJoinAt: p.firstJoinAt,
    lastLeftAt: p.lastLeftAt,
    totalDurationMin: p.totalDurationMin,
    scheduledDurationMin: session.scheduledDurationMin,
    attendancePct: p.attendancePct,
    status: p.attendanceStatus,
    joinCount: p.joinCount,
    leaveCount: p.leaveCount,
    online: p.online,
  }));
}

function safeView(session, role) {
  const online = session.participants.filter((p) => p.online).length;
  // Must match issueJoin/startSession's resumableStatuses — a class with
  // recording on (the default) goes through 'recording_processing' /
  // 'recording_available' when it ends, not 'ended', so checking only
  // 'ended' here left canJoin/canStart both false for the entire scheduled
  // window after any normal end, hiding the Join button from the teacher
  // even though the backend would have happily resumed it.
  const resumable =
    ['ended', 'recording_processing', 'recording_available'].includes(session.status) && withinScheduledWindow(session);
  return {
    id: String(session._id),
    title: session.title,
    description: session.description,
    courseTitle: session.courseTitle,
    batchName: session.batchName,
    teacherName: session.teacherName,
    sessionIndex: session.sessionIndex,
    scheduledStart: session.scheduledStart,
    scheduledEnd: session.scheduledEnd,
    scheduledDurationMin: session.scheduledDurationMin,
    actualStart: session.actualStart,
    actualEnd: session.actualEnd,
    status: DISPLAY[session.status] || session.status.toUpperCase(),
    lifecycle: session.status,
    meetingProvider: session.meetingProvider,
    isMock: session.isMock,
    roomName: session.roomName,
    recording: { enabled: session.recordingEnabled, status: session.recordingStatus },
    participantsOnline: online,
    participantCount: session.participants.length,
    myRole: role === 'system' ? null : role,
    autoStartAt: !!session.autoStartAt,
    batchId: session.batch ? String(session.batch) : null,
    canStart: role === 'teacher' && (['scheduled', 'upcoming'].includes(session.status) || resumable),
    canEnd: role === 'teacher' && ['live', 'starting'].includes(session.status),
    canEditTime: role === 'teacher' && ['scheduled', 'upcoming'].includes(session.status),
    canAddStudent: role === 'teacher' && !!session.batch,
    // "resumable" — status is 'ended' but the batch's scheduled time is
    // still running (withinScheduledWindow) — so a premature/accidental End
    // (or the auto-lifecycle tick) doesn't permanently lock either side out
    // of a class that should still be joinable. See issueJoin/startSession.
    canJoin:
      (role === 'teacher' && (['scheduled', 'upcoming', 'live'].includes(session.status) || resumable)) ||
      (role === 'student' && (session.status === 'live' || resumable)),
    canWatchRecording: ['recording_available'].includes(session.status),
    // NO meetingId / passwords / raw URL
  };
}

async function listFor(admin, { scope, batchId, courseTitle, teacherName, from, to } = {}) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const q = { removed: false };
  if (batchId) q.batch = batchId;
  if (courseTitle) q.courseTitle = courseTitle;
  if (teacherName) q.teacherName = teacherName;
  if (from || to) q.scheduledStart = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) };
  const all = await LmsLiveSession.find(q).sort({ scheduledStart: 1, created: -1 }).limit(500);
  const out = [];
  for (const sn of all) {
    const role = await resolveRole(sn, admin);
    if (!role) continue;
    const v = safeView(sn, role);
    if (scope === 'live' && sn.status !== 'live') continue;
    if (scope === 'upcoming' && !['scheduled', 'upcoming', 'starting'].includes(sn.status)) continue;
    if (scope === 'ended' && !['ended', 'recording_processing', 'recording_available'].includes(sn.status)) continue;
    out.push(v);
  }
  if (scope) return out;

  // Default (no scope) = "what can I join right now / next" — one card per
  // batch instead of every individual recurring date. A batch running
  // Mon-Fri for 6 months (see recurrence.js) generates ~130 sessions; the
  // Live Classes page only wants the one that's actually relevant per
  // batch: live right now, else the soonest upcoming one, else (nothing
  // scheduled) the most recently ended one so the batch doesn't just
  // disappear from the list.
  const rank = (v) => (['live', 'starting'].includes(v.status) ? 0 : ['scheduled', 'upcoming'].includes(v.status) ? 1 : 2);
  const best = new Map();
  for (const v of out) {
    const key = v.batchId || v.batchName || v.id;
    const cur = best.get(key);
    if (!cur) {
      best.set(key, v);
      continue;
    }
    const rv = rank(v);
    const rc = rank(cur);
    if (rv < rc) {
      best.set(key, v);
      continue;
    }
    if (rv !== rc) continue;
    const vIsSooner = new Date(v.scheduledStart || 0) < new Date(cur.scheduledStart || 0);
    const better = rv === 2 ? !vIsSooner : vIsSooner; // ended: most recent wins; live/upcoming: soonest wins
    if (better) best.set(key, v);
  }
  return [...best.values()].sort((a, b) => new Date(a.scheduledStart || 0) - new Date(b.scheduledStart || 0));
}

async function getOne(id, admin) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const sn = await LmsLiveSession.findById(id);
  if (!sn || sn.removed) return { error: 404, message: 'Live class not found.' };
  const role = await resolveRole(sn, admin);
  if (!role) return { error: 403, message: 'Not permitted.' };
  return { result: { ...safeView(sn, role), attendees: role === 'teacher' ? attendanceRows(sn) : undefined } };
}

module.exports = {
  computeRoomName,
  computeBatchRoomName,
  createSession,
  onBatchCreated,
  regenerateForBatch,
  ensureBatchRoom,
  updateSchedule,
  addStudentToBatch,
  searchStudents,
  listBatchStudents,
  removeStudentFromBatch,
  startSession,
  endSession,
  issueJoin,
  redeemTicket,
  recordLeave,
  handleBbbEvent,
  applyRecordingReady,
  autoLifecycleTick,
  pollRecordings,
  listFor,
  getOne,
  resolveRole,
  attendanceRows,
  safeView,
};
