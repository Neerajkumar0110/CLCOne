const mongoose = require('mongoose');
const { lmsConfig } = require('../config/lms');
const { queue, syncService } = require('../services/lms');

// In-process worker for the LMS integration. Same shape as
// jobs/facebookWebhookRetry.js — no external queue infra in this app.
//
//   1. drain the outbound sync queue (LmsSyncJob) → Moodle
//   2. retry failed inbound webhook events (LmsWebhookEvent)
//   3. once per day at LMS_SYNC_RECONCILE_HOUR, run the drift report
//
// Every branch is wrapped so a bad tick can never crash the process, and the
// whole job is a no-op until MOODLE_WS_URL / MOODLE_WS_TOKEN are set.

const TICK_MS = lmsConfig.sync.tickMs;
let _reconciledOnDay = null;

async function dispatch(job) {
  const Admin = mongoose.model('Admin');
  const p = job.payload || {};

  switch (job.kind) {
    case 'user.provision':
    case 'user.update': {
      const user = await Admin.findById(p.crmUserId);
      if (!user) return { skipped: 'user gone' };
      return syncService.provisionUser(user);
    }
    case 'user.role': {
      const MoodleUserMap = mongoose.model('MoodleUserMap');
      const map = await MoodleUserMap.findOne({ crmUser: p.crmUserId });
      if (map) await syncService.assignSystemRole(map);
      return { ok: true };
    }
    case 'user.suspend':
      return syncService.suspendUser(p.crmUserId);
    case 'course.mirror': {
      const Course = mongoose.model('Course');
      const course = await Course.findById(p.crmCourseId);
      if (!course) return { skipped: 'course gone' };
      return syncService.mirrorCourse(course);
    }
    case 'cohort.upsert': {
      const Batch = mongoose.model('Batch');
      const batch = await Batch.findById(p.batchId);
      if (!batch) return { skipped: 'batch gone' };
      return syncService.upsertCohort(batch);
    }
    case 'cohort.member.add':
      return syncService.setCohortMembership(p.batchId, { addMoodleUserIds: p.moodleUserIds || [] });
    case 'cohort.member.remove':
      return syncService.setCohortMembership(p.batchId, { removeMoodleUserIds: p.moodleUserIds || [] });
    case 'enrol':
      return syncService.enrolUser(p);
    case 'unenrol':
      return syncService.unenrolUser(p);
    default:
      return { skipped: `unknown kind ${job.kind}` };
  }
}

async function drainQueue() {
  for (let i = 0; i < lmsConfig.sync.batchSize; i += 1) {
    const job = await queue.claimDue();
    if (!job) break;
    try {
      const result = await dispatch(job);
      await queue.settle(job, { ok: true, result: safe(result) });
    } catch (err) {
      await queue.settle(job, { ok: false, error: err });
    }
  }
}

async function retryWebhooks() {
  const LmsWebhookEvent = mongoose.model('LmsWebhookEvent');
  const { processEvent } = require('../controllers/appControllers/lmsController');
  const due = await LmsWebhookEvent.find({
    status: 'failed',
    attempts: { $lt: lmsConfig.sync.maxAttempts },
    $or: [{ nextRetryAt: { $lte: new Date() } }, { nextRetryAt: { $exists: false } }],
  })
    .limit(20)
    .exec();

  for (const evt of due) {
    try {
      await processEvent(evt);
    } catch (err) {
      evt.attempts += 1;
      evt.lastError = err.message;
      evt.status = evt.attempts >= lmsConfig.sync.maxAttempts ? 'dead' : 'failed';
      evt.nextRetryAt = new Date(Date.now() + TICK_MS * 2 ** evt.attempts);
      await evt.save();
    }
  }
}

async function maybeReconcile() {
  const hour = lmsConfig.sync.reconcileHour;
  if (hour < 0) return;
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  if (now.getHours() === hour && _reconciledOnDay !== dayKey) {
    _reconciledOnDay = dayKey;
    const report = await syncService.reconcile();
    console.log('[lms] nightly reconcile:', JSON.stringify(report.drift));
    // Phase 8 wires this into the CRM audit log; console for now.
  }
}

function safe(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch (e) {
    return undefined;
  }
}

function startLmsSyncTick() {
  if (!lmsConfig.isConfigured) {
    console.log('[lms] sync tick idle — set MOODLE_WS_URL / MOODLE_WS_TOKEN to activate.');
  }
  setInterval(async () => {
    try {
      // queue + webhook retries run even while unconfigured so jobs park
      // cleanly; syncService functions no-op until Moodle is reachable.
      await drainQueue();
      await retryWebhooks();
      await maybeReconcile();
    } catch (err) {
      console.error('lmsSyncTick error:', err.message);
    }
  }, TICK_MS);
}

module.exports = startLmsSyncTick;
