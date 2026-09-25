const mongoose = require('mongoose');
const { lmsConfig, liveClassService } = require('../services/lms');
const settingsService = require('../services/lms/settingsService');
const { notifyUser } = require('../notify');

// In-process worker for live classes (same shape as jobs/lmsSyncTick.js — no
// cron, no new services). Every ~30s:
//   1. lifecycle: scheduled->upcoming, optional auto-start, auto-end on grace
//   2. recording poll (BBB) for sessions in RECORDING_PROCESSING
//   3. class notifications: N-min reminders, "started", "recording available"
// No-op noise is minimal; wrapped so a bad tick never crashes the process.

const TICK_MS = Number(process.env.LMS_LIVE_TICK_MS || 30000);

async function recipients(session) {
  const out = new Map(); // crmUserId -> role
  if (session.teacherCrmUser) out.set(String(session.teacherCrmUser), 'teacher');
  if (session.moodleCourseId) {
    const LmsEnrolment = mongoose.model('LmsEnrolment');
    // status: 'active' only — 'pending'/'suspended'/'ended' must not still
    // receive class notifications (spec §7).
    const enr = await LmsEnrolment.find({ moodleCourseId: session.moodleCourseId, status: 'active' }, 'crmUser roleShortname').lean();
    enr.forEach((e) => out.set(String(e.crmUser), e.roleShortname === 'editingteacher' ? 'teacher' : 'student'));
  }
  // Falls back to the batch's Student roster, matched to its login (Admin)
  // account by email — Moodle sync is optional, so LmsEnrolment can be
  // completely empty (no Moodle course wired up yet) while the batch still
  // has real students on its roster; without this, reminders/start/
  // recording notifications would only ever reach the teacher.
  if (session.batchName) {
    const Student = mongoose.model('Student');
    const Admin = mongoose.model('Admin');
    // status: 'Active' only — spec §2 "Archive/suspend/withdraw states must
    // immediately affect all scheduled communications" (a Dropped/On Hold/
    // Completed/Deferred student must stop getting class-reminder pings).
    const roster = await Student.find({ removed: false, batch: session.batchName, status: 'Active' }, 'email').lean();
    const emails = roster.map((r) => r.email).filter(Boolean);
    if (emails.length) {
      const emailRxs = emails.map((e) => new RegExp(`^${String(e).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
      const admins = await Admin.find({ removed: false, email: { $in: emailRxs } }, '_id').lean();
      admins.forEach((a) => !out.has(String(a._id)) && out.set(String(a._id), 'student'));
    }
  }
  (session.participants || []).forEach((p) => p.crmUser && !out.has(String(p.crmUser)) && out.set(String(p.crmUser), p.role));

  // Final catch-all (spec §7): drop anyone whose login is currently on
  // rosterHold (Student.status moved away from Active — see
  // services/lms/studentAccountService.js#syncRosterHold) regardless of
  // which branch above added them — covers a stale participants[] row from
  // before they were archived, which none of the branch-level status filters
  // above can see.
  if (out.size) {
    const Admin = mongoose.model('Admin');
    const held = await Admin.find({ _id: { $in: [...out.keys()] }, rosterHold: true }, '_id').lean();
    held.forEach((a) => out.delete(String(a._id)));
  }
  return out;
}

async function fanout(session, { type, title, body }) {
  const link = '/lms/classes';
  const rec = await recipients(session);
  for (const [uid] of rec) {
    await notifyUser({ recipient: uid, module: 'LMS', type, title, body, link }).catch(() => {});
  }
}

async function runNotifications() {
  const s = await settingsService.get();
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const now = Date.now();

  // reminders
  if (Array.isArray(s.notifyBeforeMins) && s.notifyBeforeMins.length) {
    const soon = await LmsLiveSession.find({
      removed: false,
      status: { $in: ['scheduled', 'upcoming'] },
      scheduledStart: { $gt: new Date(now), $lte: new Date(now + Math.max(...s.notifyBeforeMins) * 60000 + TICK_MS) },
    }).limit(50);
    for (const session of soon) {
      const minsAway = Math.round((new Date(session.scheduledStart) - now) / 60000);
      for (const m of s.notifyBeforeMins) {
        if (minsAway <= m && !session.notifiedBeforeMins.includes(m)) {
          await fanout(session, {
            type: 'live.reminder',
            title: `Live class ${m >= 60 ? `in ${Math.round(m / 60)}h` : `in ${m} min`}`,
            body: `${session.title} · ${session.courseTitle || ''}`.trim(),
          });
          session.notifiedBeforeMins.push(m);
        }
      }
      await session.save();
    }
  }

  // started
  if (s.notifyOnStart) {
    const started = await LmsLiveSession.find({ removed: false, status: 'live', notifiedStart: false }).limit(30);
    for (const session of started) {
      await fanout(session, { type: 'live.started', title: 'Live class has started', body: session.title });
      session.notifiedStart = true;
      await session.save();
    }
  }

  // recording available
  if (s.notifyOnRecording) {
    const ready = await LmsLiveSession.find({ removed: false, status: 'recording_available', notifiedRecording: false }).limit(30);
    for (const session of ready) {
      await fanout(session, {
        type: 'live.recording',
        title: 'Class recording is now available',
        body: session.title,
      });
      session.notifiedRecording = true;
      await session.save();
    }
  }
}

// One full tick's worth of work, extracted so it can run either on the
// setInterval below (persistent process — VPS/PM2) or on-demand from a
// serverless cron endpoint (backend/src/routes/appRoutes/cronApi.js) where
// setInterval never fires because the process doesn't stay alive between
// requests. Safe to call repeatedly/concurrently — every branch only acts on
// rows that are actually due.
async function runOnce() {
  require('../services/lms/health').ping('lmsLiveTick');
  try {
    await liveClassService.autoLifecycleTick();
  } catch (e) {
    console.error('lmsLiveTick lifecycle:', e.message);
  }
  try {
    await liveClassService.pollRecordings();
  } catch (e) {
    console.error('lmsLiveTick recordings:', e.message);
  }
  try {
    await runNotifications();
  } catch (e) {
    console.error('lmsLiveTick notify:', e.message);
  }
}

function start() {
  setInterval(runOnce, TICK_MS);
  console.log(`[lms] live tick every ${Math.round(TICK_MS / 1000)}s — provider: ${lmsConfig.meeting.effectiveProvider}`);
}

start.runOnce = runOnce;
module.exports = start;
