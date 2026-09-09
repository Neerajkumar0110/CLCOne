const mongoose = require('mongoose');
const { getMoodleClient } = require('../../../services/lms');

// POST /api/lms/webhook/moodle — events from local_crmbridge. The request is
// already HMAC-verified by middlewares/moodleWebhookAuth. We persist first
// (idempotent on eventid), answer 200 fast, then process. Failed rows are
// retried by jobs/lmsSyncTick.js.
//
// Envelope from Moodle:
//   { eventid, eventname, timestamp, host, payload: { ...event specific } }

const HANDLERS = {
  '\\core\\event\\user_enrolment_created': onEnrolmentCreated,
  '\\core\\event\\user_enrolment_deleted': onEnrolmentDeleted,
  '\\core\\event\\course_completed': onCourseCompleted,
  '\\mod_quiz\\event\\attempt_submitted': onGradeableActivity,
  '\\mod_assign\\event\\submission_graded': onGradeableActivity,
  '\\core\\event\\badge_awarded': onBadgeAwarded,
  '\\tool_customcert\\event\\certificate_issued': onCertificateIssued,
  // bbb + recording events land here in Phase 6; ignored for now
};

async function receive(req, res) {
  const LmsWebhookEvent = mongoose.model('LmsWebhookEvent');
  const body = req.body || {};
  const eventId = String(body.eventid || body.eventId || '');
  const eventName = String(body.eventname || body.eventName || '');

  if (!eventId || !eventName) {
    return res.status(400).json({ success: false, message: 'Missing eventid / eventname.' });
  }

  // idempotency — a re-delivery just gets a 200
  const existing = await LmsWebhookEvent.findOne({ eventId });
  if (existing) {
    return res.status(200).json({ success: true, message: 'duplicate', status: existing.status });
  }

  const evt = await LmsWebhookEvent.create({
    eventId,
    eventName,
    signatureNonce: req.moodleWebhook && req.moodleWebhook.nonce,
    payload: body.payload || body,
    status: 'received',
  });

  // process inline but never let it fail the ack
  try {
    await processEvent(evt);
  } catch (err) {
    evt.status = 'failed';
    evt.attempts += 1;
    evt.lastError = err.message;
    evt.nextRetryAt = new Date(Date.now() + 60 * 1000);
    await evt.save();
  }

  return res.status(200).json({ success: true, message: 'ok', status: evt.status });
}

// Also called by the retry job.
async function processEvent(evt) {
  const handler = HANDLERS[evt.eventName];
  if (!handler) {
    evt.status = 'skipped';
    evt.processedAt = new Date();
    await evt.save();
    return evt;
  }
  await handler(evt.payload || {});
  evt.status = 'processed';
  evt.processedAt = new Date();
  evt.lastError = undefined;
  await evt.save();
  getMoodleClient().bust(''); // conservative: drop cached reads after any write-back
  return evt;
}

// ── individual handlers ───────────────────────────────────────────────
async function resolveEnrolment(payload) {
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  const moodleUserId = Number(payload.relateduserid || payload.userid);
  const moodleCourseId = Number(payload.courseid);
  if (!moodleUserId || !moodleCourseId) return null;

  let enr = await LmsEnrolment.findOne({ moodleUserId, moodleCourseId });
  if (enr) return enr;

  // make sure the course is mapped (an enrolment can arrive for a course the
  // CRM has never mirrored — e.g. one built directly in Moodle)
  const courseMap = await require('../../../services/lms')
    .syncService.ensureCourseMapFromMoodle(moodleCourseId)
    .catch(() => null);

  // an enrolment made directly in Moodle — mirror it so the portals see it
  const userMap = await MoodleUserMap.findOne({ moodleUserId });
  if (!userMap) return null;
  return LmsEnrolment.create({
    crmCourse: courseMap && !courseMap.extra?.unmatchedFromMoodle ? courseMap.crmId : undefined,
    crmUser: userMap.crmUser,
    moodleUserId,
    moodleCourseId,
    source: 'reconcile',
    status: 'active',
    syncStatus: 'synced',
    lastSyncedAt: new Date(),
  });
}

async function onEnrolmentCreated(payload) {
  const enr = await resolveEnrolment(payload);
  if (enr && enr.status !== 'active') {
    enr.status = 'active';
    enr.lastSyncedAt = new Date();
    await enr.save();
  }
}

async function onEnrolmentDeleted(payload) {
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const moodleUserId = Number(payload.relateduserid || payload.userid);
  const moodleCourseId = Number(payload.courseid);
  await LmsEnrolment.updateOne(
    { moodleUserId, moodleCourseId },
    { $set: { status: 'ended', lastSyncedAt: new Date() } }
  );
}

async function onCourseCompleted(payload) {
  const enr = await resolveEnrolment(payload);
  if (!enr) return;
  enr.progressPct = 100;
  enr.completedOn = payload.timecompleted ? new Date(payload.timecompleted * 1000) : new Date();
  enr.lastActivityAt = new Date();
  enr.lastSyncedAt = new Date();
  await enr.save();

  // keep the CRM Student projection in step where one exists
  const Student = mongoose.model('Student');
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  const userMap = await MoodleUserMap.findOne({ moodleUserId: enr.moodleUserId }).populate('crmUser');
  if (userMap && userMap.crmUser && userMap.crmUser.email) {
    await Student.updateMany(
      { email: userMap.crmUser.email, removed: false },
      { $set: { progress: 100, updated: new Date() } }
    );
  }
}

async function onGradeableActivity(payload) {
  const enr = await resolveEnrolment(payload);
  if (!enr) return;
  enr.lastActivityAt = new Date();
  enr.lastSyncedAt = new Date();

  // pull the up-to-date course total from Moodle (best-effort)
  try {
    const client = getMoodleClient();
    if (client.configured) {
      const report = await client.getUserGrades(enr.moodleCourseId, enr.moodleUserId);
      const courseItem =
        report &&
        report.usergrades &&
        report.usergrades[0] &&
        (report.usergrades[0].gradeitems || []).find((g) => g.itemtype === 'course');
      if (courseItem && courseItem.percentageformatted) {
        const pct = parseFloat(String(courseItem.percentageformatted).replace('%', ''));
        if (Number.isFinite(pct)) enr.finalGrade = pct;
      }
    }
  } catch (e) {
    /* non-fatal — the nightly reconcile will catch it */
  }
  await enr.save();
}

async function onBadgeAwarded(payload) {
  // Phase 7 wires the points ledger. For now record activity.
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const moodleUserId = Number(payload.relateduserid || payload.userid);
  if (moodleUserId) {
    await LmsEnrolment.updateMany({ moodleUserId }, { $set: { lastActivityAt: new Date() } });
  }
}

async function onCertificateIssued(payload) {
  const Certificate = mongoose.model('Certificate');
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  const moodleUserId = Number(payload.relateduserid || payload.userid);
  const userMap = moodleUserId ? await MoodleUserMap.findOne({ moodleUserId }).populate('crmUser') : null;
  const code = String(payload.code || payload.certificatecode || payload.objectid || '');
  if (!code) return;

  await Certificate.updateOne(
    { certificateId: code },
    {
      $set: {
        certificateId: code,
        student: userMap && userMap.crmUser ? userMap.crmUser.name : payload.fullname || '',
        status: 'Issued',
        issuedOn: payload.timecreated ? new Date(payload.timecreated * 1000) : new Date(),
        verificationUrl: payload.verifyurl || '',
        updated: new Date(),
      },
    },
    { upsert: true }
  );
}

module.exports = { receive, processEvent };
