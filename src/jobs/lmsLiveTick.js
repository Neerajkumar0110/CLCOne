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
    const enr = await LmsEnrolment.find({ moodleCourseId: session.moodleCourseId, status: { $ne: 'ended' } }, 'crmUser roleShortname').lean();
    enr.forEach((e) => out.set(String(e.crmUser), e.roleShortname === 'editingteacher' ? 'teacher' : 'student'));
  }
  (session.participants || []).forEach((p) => p.crmUser && !out.has(String(p.crmUser)) && out.set(String(p.crmUser), p.role));
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

function start() {
  setInterval(async () => {
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
  }, TICK_MS);
  console.log(`[lms] live tick every ${Math.round(TICK_MS / 1000)}s — provider: ${lmsConfig.meeting.effectiveProvider}`);
}

module.exports = start;
