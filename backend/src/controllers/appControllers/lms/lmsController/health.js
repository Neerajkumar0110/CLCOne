const mongoose = require('mongoose');
const { lmsConfig } = require('../../../../config/lms');
const mailer = require('../../../../services/lms/mailer');
const health = require('../../../../services/lms/health');
const razorpayService = require('../../../../services/payments/razorpayService');

// System health for the Admin portal (spec §2 "admin access... monitoring",
// §18 "health checks for LMS, database, ... email provider, meeting
// provider" + "background worker monitoring"). Management only.

function jobStatus(name, maxAgeMs) {
  const last = health.snapshot()[name];
  if (!last) return { ok: false, lastRun: null, note: 'never run in this process (check the VPS — ticks are no-op on serverless)' };
  return { ok: Date.now() - new Date(last).getTime() < maxAgeMs, lastRun: last };
}

// GET /api/lms/admin/system-health
async function systemHealth(req, res) {
  const AuditLog = mongoose.model('AuditLog');
  const LmsSetting = mongoose.model('LmsSetting');
  const LmsWebhookEvent = mongoose.model('LmsWebhookEvent');
  const LiveRecording = mongoose.model('LiveRecording');
  const dbState = mongoose.connection.readyState; // 1 = connected
  const auditActivity24h = await AuditLog.countDocuments({ created: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } }).catch(() => 0);
  const incidentRow = await LmsSetting.findOne({ key: 'incident' }).lean();
  const failedWebhooks = await LmsWebhookEvent.countDocuments({ status: { $in: ['failed', 'dead'] } }).catch(() => 0);
  const failedRecordings = await LiveRecording.countDocuments({ status: 'FAILED' }).catch(() => 0);
  const razorpay = await razorpayService.checkHealth().catch((e) => ({ configured: false, reachable: false, error: e.message }));

  return res.status(200).json({
    success: true,
    result: {
      database: { ok: dbState === 1, state: ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] || String(dbState) },
      mailer: { ok: mailer.ready() },
      meetingProvider: { provider: lmsConfig.meeting.effectiveProvider, live: lmsConfig.meeting.effectiveProvider !== 'mock' },
      paymentGateway: { ok: razorpay.reachable, ...razorpay },
      jobs: {
        liveTick: jobStatus('lmsLiveTick', 5 * 60 * 1000),
        policyReminderTick: jobStatus('lmsPolicyReminderTick', 24 * 3600 * 1000),
        syncTick: jobStatus('lmsSyncTick', 5 * 60 * 1000),
        // Previously pinged but not surfaced here — an admin had no way to
        // tell if EMI reminders or the daily summary email had gone stale.
        financeEmiTick: jobStatus('financeEmiTick', 2 * 3600 * 1000),
        dailySummaryTick: jobStatus('lmsDailySummaryTick', 2 * 3600 * 1000),
      },
      failedWebhooks,
      failedRecordings,
      auditActivity24h,
      // Spec §5 "incident mode" — a manually-toggled flag any manager can
      // set/clear (see toggleIncidentMode below) so a live incident has one
      // visible, shared place instead of only living in a Slack thread.
      incidentMode: {
        active: !!(incidentRow && incidentRow.incidentMode),
        message: (incidentRow && incidentRow.incidentMessage) || '',
        setAt: incidentRow && incidentRow.incidentSetAt,
        setByName: incidentRow && incidentRow.incidentSetByName,
      },
      checkedAt: new Date(),
    },
  });
}

// POST /api/lms/admin/incident-mode  { active, message } — manager only.
async function toggleIncidentMode(req, res) {
  const LmsSetting = mongoose.model('LmsSetting');
  const active = !!(req.body || {}).active;
  const message = String((req.body || {}).message || '').trim();
  const row = await LmsSetting.findOneAndUpdate(
    { key: 'incident' },
    {
      $set: {
        incidentMode: active,
        incidentMessage: active ? message : '',
        incidentSetAt: new Date(),
        incidentSetByName: req.admin.name || req.admin.email,
        updated: new Date(),
      },
    },
    { new: true, upsert: true }
  ).lean();
  try {
    await require('../../../../notify').notify({
      audience: 'management',
      module: 'Security',
      type: active ? 'incident.started' : 'incident.ended',
      title: active ? `Incident mode activated by ${row.incidentSetByName}` : `Incident mode cleared by ${row.incidentSetByName}`,
      body: active ? message || 'No details given.' : 'Marked resolved.',
      link: '/lms/admin/health',
    });
  } catch (e) {
    /* best-effort */
  }
  return res.status(200).json({ success: true, result: { active: row.incidentMode, message: row.incidentMessage } });
}

// GET /api/lms/admin/email-logs?status=&recipient=&limit= — manager only.
// Spec §8 "delivery logs" — see services/lms/mailer.js#logDelivery.
async function emailDeliveryLogs(req, res) {
  const EmailDeliveryLog = mongoose.model('EmailDeliveryLog');
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.recipient) q.recipient = new RegExp(String(req.query.recipient).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const rows = await EmailDeliveryLog.find(q)
    .sort({ sentAt: -1 })
    .limit(Math.min(500, Number(req.query.limit) || 200))
    .lean();
  return res.status(200).json({ success: true, result: rows });
}

module.exports = { systemHealth, toggleIncidentMode, emailDeliveryLogs };
