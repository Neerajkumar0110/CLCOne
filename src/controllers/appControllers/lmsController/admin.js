const crypto = require('crypto');
const mongoose = require('mongoose');
const { getMoodleClient, lmsConfig, syncService, queue } = require('../../../services/lms');
const { sign } = require('../../../services/lms/httpSign');

// LMS ops / integration health — for the Admin portal "System" area. All
// behind the CRM bearer gate; the route layer adds a role check.

// GET /api/lms/admin/status
async function status(req, res) {
  const client = getMoodleClient();
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const LmsSyncJob = mongoose.model('LmsSyncJob');
  const LmsWebhookEvent = mongoose.model('LmsWebhookEvent');

  let site = null;
  let moodleReachable = false;
  if (client.configured) {
    try {
      site = await client.siteInfo();
      moodleReachable = true;
    } catch (e) {
      site = { error: e.message };
    }
  }

  const [users, usersFailed, enrol, enrolFailed, jobsPending, jobsDead, evtFailed, evtDead] = await Promise.all([
    MoodleUserMap.countDocuments({}),
    MoodleUserMap.countDocuments({ syncStatus: 'failed' }),
    LmsEnrolment.countDocuments({}),
    LmsEnrolment.countDocuments({ syncStatus: 'failed' }),
    LmsSyncJob.countDocuments({ status: 'pending' }),
    LmsSyncJob.countDocuments({ status: 'dead' }),
    LmsWebhookEvent.countDocuments({ status: 'failed' }),
    LmsWebhookEvent.countDocuments({ status: 'dead' }),
  ]);

  return res.status(200).json({
    success: true,
    result: {
      configured: lmsConfig.isConfigured,
      moodleReachable,
      breakerOpen: client._breakerOpen ? client._breakerOpen() : false,
      site: site
        ? { sitename: site.sitename, release: site.release, username: site.username, userid: site.userid, functions: (site.functions || []).length }
        : null,
      counts: { users, usersFailed, enrolments: enrol, enrolFailed, jobsPending, jobsDead, webhookFailed: evtFailed, webhookDead: evtDead },
      sso: { enabled: !!(lmsConfig.isConfigured && lmsConfig.sso.secret) },
      webhook: { enabled: !!lmsConfig.webhook.hmacSecret },
      bbb: { configured: !!(lmsConfig.bbb.url && lmsConfig.bbb.secret) },
    },
  });
}

// POST /api/lms/admin/test-connection — crisp pass/fail + latency. Bypasses
// the read cache. This is the "connection health check".
async function testConnection(req, res) {
  if (!lmsConfig.isConfigured) {
    return res.status(200).json({
      success: true,
      result: { ok: false, reason: 'not_configured', hint: 'Set MOODLE_WS_URL and MOODLE_WS_TOKEN in backend/.env, then restart.' },
    });
  }
  const probe = await getMoodleClient().ping();
  return res.status(probe.ok ? 200 : 502).json({ success: probe.ok, result: probe });
}

// POST /api/lms/admin/sync-user/:id — provision ONE CRM user now (synchronous).
async function syncUser(req, res) {
  const Admin = mongoose.model('Admin');
  const user = await Admin.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'CRM user not found.' });
  const map = await syncService.provisionUser(user);
  return res.status(200).json({
    success: true,
    result: {
      crmUserId: String(user._id),
      moodleUserId: map.moodleUserId || null,
      username: map.username,
      lmsRole: map.lmsRole,
      syncStatus: map.syncStatus,
      lastError: map.lastError || null,
    },
  });
}

// POST /api/lms/admin/sync-course/:id — mirror ONE CRM course now (creates the
// Moodle shell if absent).
async function syncCourse(req, res) {
  const Course = mongoose.model('Course');
  const course = await Course.findById(req.params.id);
  if (!course) return res.status(404).json({ success: false, message: 'CRM course not found.' });
  const map = await syncService.mirrorCourse(course);
  return res.status(200).json({
    success: true,
    result: {
      crmCourseId: String(course._id),
      moodleCourseId: map.moodleId || null,
      shortname: map.shortname,
      syncStatus: map.syncStatus,
      lastError: map.lastError || null,
    },
  });
}

// POST /api/lms/admin/enrol  { crmUserId, crmCourseId, roleShortname? }
// Full path: provision the user (if needed) → mirror the course (if needed) →
// enrol. Idempotent.
async function enrol(req, res) {
  const { crmUserId, crmCourseId, roleShortname = 'student', timeend } = req.body || {};
  if (!crmUserId || !crmCourseId) {
    return res.status(400).json({ success: false, message: 'crmUserId and crmCourseId are required.' });
  }
  const Admin = mongoose.model('Admin');
  const Course = mongoose.model('Course');
  const user = await Admin.findById(crmUserId);
  const course = await Course.findById(crmCourseId);
  if (!user) return res.status(404).json({ success: false, message: 'CRM user not found.' });
  if (!course) return res.status(404).json({ success: false, message: 'CRM course not found.' });

  const userMap = await syncService.provisionUser(user);
  const courseMap = await syncService.mirrorCourse(course);
  if (!courseMap.moodleId) {
    return res.status(502).json({ success: false, message: 'Course could not be created in Moodle.', result: { courseMap } });
  }
  const enrolment = await syncService.enrolUser({
    crmUserId,
    crmCourseId,
    moodleCourseId: courseMap.moodleId,
    roleShortname,
    source: 'admin',
    timeend,
  });
  return res.status(200).json({
    success: true,
    result: {
      moodleUserId: userMap.moodleUserId,
      moodleCourseId: courseMap.moodleId,
      status: enrolment.status,
      syncStatus: enrolment.syncStatus,
      lastError: enrolment.lastError || null,
    },
  });
}

// POST /api/lms/admin/unenrol  { crmUserId, crmCourseId? , moodleCourseId? }
async function unenrol(req, res) {
  const { crmUserId, crmCourseId, moodleCourseId } = req.body || {};
  let mid = moodleCourseId;
  if (!mid && crmCourseId) {
    const m = await mongoose.model('MoodleObjectMap').findOne({ kind: 'course', crmId: crmCourseId });
    mid = m && m.moodleId;
  }
  if (!crmUserId || !mid) {
    return res.status(400).json({ success: false, message: 'crmUserId and a resolvable course are required.' });
  }
  const enr = await syncService.unenrolUser({ crmUserId, moodleCourseId: mid });
  return res.status(200).json({ success: true, result: enr ? { status: enr.status, syncStatus: enr.syncStatus } : null });
}

// GET /api/lms/admin/mappings?type=users|courses|cohorts|enrolments&limit=50
async function mappings(req, res) {
  const type = req.query.type || 'users';
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  let rows = [];
  if (type === 'users') {
    rows = await mongoose.model('MoodleUserMap').find({}).sort({ updated: -1 }).limit(limit).lean();
  } else if (type === 'enrolments') {
    rows = await mongoose.model('LmsEnrolment').find({}).sort({ updated: -1 }).limit(limit).lean();
  } else {
    rows = await mongoose
      .model('MoodleObjectMap')
      .find({ kind: type.replace(/s$/, '') })
      .sort({ updated: -1 })
      .limit(limit)
      .lean();
  }
  return res.status(200).json({ success: true, result: { type, count: rows.length, rows } });
}

// POST /api/lms/admin/webhook-selftest — sign a synthetic envelope with the
// configured HMAC secret and POST it to our OWN inbound webhook. Proves the
// signature verify + idempotency path without waiting on Moodle cron.
async function webhookSelftest(req, res) {
  if (!lmsConfig.webhook.hmacSecret) {
    return res.status(503).json({ success: false, message: 'MOODLE_WEBHOOK_HMAC_SECRET is not set.' });
  }
  const eventId = `selftest-${Date.now()}`;
  const envelope = {
    eventid: eventId,
    eventname: '\\local_crmbridge\\event\\ping',
    timestamp: Math.floor(Date.now() / 1000),
    host: 'selftest',
    payload: { note: 'admin webhook-selftest' },
  };
  const rawBody = JSON.stringify(envelope);
  const base = process.env.APP_URL || process.env.PUBLIC_SERVER_FILE || `http://127.0.0.1:${process.env.PORT || 8888}/`;
  const url = base.replace(/\/+$/, '') + '/api/lms/webhook/moodle';

  // one signed POST (each call re-signs with a fresh timestamp + nonce)
  const signedPost = async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(16).toString('hex');
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-crm-key': lmsConfig.webhook.apiKey || '',
        'x-crm-timestamp': timestamp,
        'x-crm-nonce': nonce,
        'x-crm-signature': sign({ secret: lmsConfig.webhook.hmacSecret, timestamp, nonce, rawBody }),
      },
      body: rawBody,
    });
    return { httpCode: r.status, body: await r.json().catch(() => ({})) };
  };

  try {
    const first = await signedPost(); // stores the event
    const replay = await signedPost(); // same eventId → recognised as duplicate
    return res.status(200).json({
      success: first.httpCode === 200,
      result: {
        url,
        firstPost: { httpCode: first.httpCode, status: first.body.status, message: first.body.message },
        replay: { httpCode: replay.httpCode, message: replay.body.message },
      },
    });
  } catch (err) {
    return res.status(502).json({ success: false, message: `Self-test request failed: ${err.message}`, result: { url } });
  }
}

// POST /api/lms/admin/reconcile
async function reconcileNow(req, res) {
  const report = await syncService.reconcile();
  return res.status(200).json({ success: true, result: report });
}

// GET /api/lms/admin/jobs?status=pending|dead|failed
async function jobs(req, res) {
  const LmsSyncJob = mongoose.model('LmsSyncJob');
  const q = {};
  if (req.query.status) q.status = req.query.status;
  const rows = await LmsSyncJob.find(q).sort({ updated: -1 }).limit(100).lean();
  return res.status(200).json({ success: true, result: rows });
}

// GET /api/lms/admin/events?status=failed|dead|processed
async function events(req, res) {
  const LmsWebhookEvent = mongoose.model('LmsWebhookEvent');
  const q = {};
  if (req.query.status) q.status = req.query.status;
  const rows = await LmsWebhookEvent.find(q).sort({ receivedAt: -1 }).limit(100).lean();
  return res.status(200).json({ success: true, result: rows });
}

// POST /api/lms/admin/jobs/:id/retry — push a dead/failed job back to pending
async function retryJob(req, res) {
  const LmsSyncJob = mongoose.model('LmsSyncJob');
  const job = await LmsSyncJob.findById(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });
  job.status = 'pending';
  job.runAfter = new Date();
  job.lastError = undefined;
  await job.save();
  return res.status(200).json({ success: true, result: job });
}

// POST /api/lms/admin/provision-all — enqueue a provision job for every
// enabled CRM user not yet mapped. One-off bootstrap for Phase 1.
async function provisionAll(req, res) {
  const Admin = mongoose.model('Admin');
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  const mapped = new Set((await MoodleUserMap.find({}, 'crmUser').lean()).map((m) => String(m.crmUser)));
  const users = await Admin.find({ removed: false, enabled: true }, '_id').lean();
  let queued = 0;
  for (const u of users) {
    if (mapped.has(String(u._id))) continue;
    await queue.enqueue('user.provision', { crmUserId: String(u._id) }, { dedupeKey: `user.provision:${u._id}` });
    queued += 1;
  }
  return res.status(200).json({ success: true, result: { queued } });
}

module.exports = {
  status,
  testConnection,
  syncUser,
  syncCourse,
  enrol,
  unenrol,
  mappings,
  webhookSelftest,
  reconcileNow,
  jobs,
  events,
  retryJob,
  provisionAll,
};
