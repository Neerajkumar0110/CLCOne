const mongoose = require('mongoose');
const { lmsConfig } = require('../../../../config/lms');
const mailer = require('../../../../services/lms/mailer');
const health = require('../../../../services/lms/health');

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
  const dbState = mongoose.connection.readyState; // 1 = connected
  const auditActivity24h = await AuditLog.countDocuments({ created: { $gte: new Date(Date.now() - 24 * 3600 * 1000) } }).catch(() => 0);

  return res.status(200).json({
    success: true,
    result: {
      database: { ok: dbState === 1, state: ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] || String(dbState) },
      mailer: { ok: mailer.ready() },
      meetingProvider: { provider: lmsConfig.meeting.effectiveProvider, live: lmsConfig.meeting.effectiveProvider !== 'mock' },
      jobs: {
        liveTick: jobStatus('lmsLiveTick', 5 * 60 * 1000),
        policyReminderTick: jobStatus('lmsPolicyReminderTick', 24 * 3600 * 1000),
        syncTick: jobStatus('lmsSyncTick', 5 * 60 * 1000),
      },
      auditActivity24h,
      checkedAt: new Date(),
    },
  });
}

module.exports = { systemHealth };
