const crypto = require('crypto');
const mongoose = require('mongoose');
const { lmsConfig } = require('../../config/lms');
const { getMeetingProvider } = require('./meeting');
const settingsService = require('./settingsService');
const recurrence = require('./recurrence');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES } = require('../../config/roles');

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
function crmBase() {
  return (
    lmsConfig.meeting.crmBaseUrl || process.env.APP_URL || process.env.PUBLIC_SERVER_FILE || 'http://200.141.5.195'
  ).replace(/\/+$/, '');
}
const isManager = (a) => !!(a && (MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role)));
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
    roomName: computeRoomName(courseTitle, batchName, title),
    publicKey: crypto.randomBytes(16).toString('hex'),
    recordingEnabled: s.recordingEnabled,
    recordingStatus: 'NOT_STARTED',
    status: 'scheduled',
    autoCreated: !!opts.autoCreated,
  });

  if (s.recordingEnabled) {
    const rec = await LiveRecording.create({
      liveSession: session._id,
      crmCourse: session.crmCourse,
      batch: session.batch,
      teacherCrmUser: session.teacherCrmUser,
      courseTitle,
      batchName,
      teacherName: session.teacherName,
      className: title,
      provider: session.meetingProvider,
      status: 'NOT_STARTED',
    });
    session.recording = rec._id;
    await session.save();
  }

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
      joinUrl: `${crmBase()}/api/lms/live-classes/${session._id}/open`,
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

/* ───────────────────────── provider room ───────────────────────── */
async function loadFull(id) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  return LmsLiveSession.findById(id).select('+moderatorPW +attendeePW +providerData +joinTickets +videoUrl +handledWebhookEvents');
}
async function ensureProviderRoom(session) {
  const provider = getMeetingProvider();
  if (session.meetingProvider !== provider.name) {
    session.meetingProvider = provider.name;
    session.isMock = provider.name === 'mock';
  }
  if (session.meetingId && session.meetingProvider !== 'mock') return session;
  const s = await settingsService.get();
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
  if (!session.liveClass) return;
  await mongoose.model('LiveClass').updateOne(
    { _id: session.liveClass },
    { $set: { status, updated: new Date(), ...extra } }
  );
}

async function startSession(id, admin, { auto = false } = {}) {
  const session = await loadFull(id);
  if (!session) return { error: 404, message: 'Live class not found.' };
  if (!auto) {
    const role = await resolveRole(session, admin);
    if (role !== 'teacher') return { error: 403, message: 'Only the class teacher can start it.' };
  }
  if (['ended', 'recording_processing', 'recording_available'].includes(session.status)) {
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
  if (session.recordingEnabled && s.recordingAutoStart) {
    session.recordingStatus = 'RECORDING';
    await mongoose.model('LiveRecording').updateOne(
      { liveSession: session._id },
      { $set: { status: 'RECORDING', startedAt: new Date(), meetingId: session.meetingId, provider: session.meetingProvider } }
    );
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
      // mock/jitsi: nothing to process — mark available with no artefact
      session.recordingStatus = s.recordingAvailableImmediately ? 'AVAILABLE' : 'PROCESSING';
      session.status = session.recordingStatus === 'AVAILABLE' ? 'recording_available' : 'recording_processing';
      await RecModel.updateOne(
        { liveSession: session._id },
        {
          $set: {
            status: session.recordingStatus,
            endedAt: now,
            durationMin: recDurationMin,
            publishedAt: session.recordingStatus === 'AVAILABLE' ? now : undefined,
          },
        }
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

  if (role === 'teacher' && ['scheduled', 'upcoming'].includes(session.status)) {
    const started = await startSession(id, admin);
    if (started.error) return started;
    return issueJoin(id, admin); // re-load now-live session
  }
  if (session.status !== 'live') {
    return { error: 409, message: role === 'student' ? 'The class has not started yet.' : 'Class is not live.' };
  }
  if (!session.meetingId && session.meetingProvider !== 'mock') await ensureProviderRoom(session);

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
  const url = await provider.getJoinUrl(session, {
    role: t.role === 'moderator' ? 'moderator' : 'viewer',
    fullName: user ? `${user.name || ''} ${user.surname || ''}`.trim() || user.email : 'Guest',
    userId: String(t.crmUser),
  });
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
  const session = await LmsLiveSession.findOne({ meetingId: evt.meetingId }).select('+handledWebhookEvents +moderatorPW +attendeePW');
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
  await RecModel.updateOne(
    { liveSession: session._id },
    {
      $set: {
        status: 'AVAILABLE',
        recordingId: recordingId || undefined,
        playbackUrl: playbackUrl || undefined,
        downloadUrl: downloadUrl || undefined,
        durationMin: durationMin || undefined,
        publishedAt: new Date(),
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

  // auto-start
  if (s.autoStartPolicy === 'at-schedule') {
    const due = await LmsLiveSession.find({
      removed: false,
      status: { $in: ['scheduled', 'upcoming'] },
      scheduledStart: { $lte: now },
      scheduledEnd: { $gt: now },
    }).limit(10);
    for (const d of due) await startSession(d._id, null, { auto: true }).catch(() => {});
  }

  // auto-end
  if (s.autoEndPolicy !== 'manual') {
    const graceMs = (s.autoEndPolicy === 'grace' ? s.autoEndGraceMin : 0) * 60000;
    const overdue = await LmsLiveSession.find({
      removed: false,
      status: 'live',
      scheduledEnd: { $lt: new Date(now.getTime() - graceMs) },
    }).limit(10);
    for (const d of overdue) await endSession(d._id, null, { auto: true }).catch(() => {});
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
  for (const session of pending) {
    try {
      const recs = await provider.getRecordings(session);
      const ready = (recs || []).find((r) => r.state === 'published' || r.published);
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
  if (isManager(admin)) return 'teacher';
  if (session.participants.some((p) => String(p.crmUser) === String(admin._id))) return 'student';
  if (session.moodleCourseId) {
    const enr = await mongoose.model('LmsEnrolment').findOne({ crmUser: admin._id, moodleCourseId: session.moodleCourseId });
    if (enr) return enr.roleShortname === 'editingteacher' ? 'teacher' : 'student';
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
    canStart: role === 'teacher' && ['scheduled', 'upcoming'].includes(session.status),
    canEnd: role === 'teacher' && ['live', 'starting'].includes(session.status),
    canJoin:
      (role === 'teacher' && ['scheduled', 'upcoming', 'live'].includes(session.status)) ||
      (role === 'student' && session.status === 'live'),
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
  return out;
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
  createSession,
  onBatchCreated,
  regenerateForBatch,
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
