const mongoose = require('mongoose');

// *** THIS JOB IS THE PRIMARY LEAD-CAPTURE MECHANISM FOR LINKEDIN. ***
// LinkedIn's Marketing API has no webhook / real-time push for Lead Gen
// Forms — unlike jobs/facebookWebhookRetry.js, which only re-processes leads
// a live webhook already told this app about and failed to save, this job
// is where every single LinkedIn lead enters the system in the first place.
// If this interval isn't running, LinkedIn leads simply never arrive.
//
// Two things happen on every tick:
//   1. A fresh poll cycle (leadSync.runPollCycle()) — fetches every Lead Gen
//      Form owned by the connected Organization and pulls responses
//      submitted since the last successful cycle's watermark.
//   2. A retry pass over LinkedInLeadSyncLog rows already marked
//      'failed'/'retrying' whose nextRetryAt has passed — same exponential
//      backoff shape (2^retryCount minutes, capped at 60, 5 max attempts)
//      as jobs/facebookWebhookRetry.js.
//
// No queue/job infra exists anywhere in this app (confirmed: no bull/agenda/
// node-cron) — this is a minimal in-process poller, appropriate given the
// app's current single-instance deployment shape, same as
// jobs/facebookWebhookRetry.js.
const POLL_INTERVAL_MS = Number(process.env.LINKEDIN_POLL_INTERVAL_MS) || 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;

function startLinkedInLeadPoller() {
  setInterval(async () => {
    try {
      const { runPollCycle, retrySyncLog } = require('../controllers/appControllers/linkedinController/leadSync');

      // 1. Fresh poll — the primary path.
      await runPollCycle();

      // 2. Retry pass — due failures from earlier cycles.
      const LinkedInLeadSyncLog = mongoose.model('LinkedInLeadSyncLog');
      const due = await LinkedInLeadSyncLog.find({
        removed: false,
        processingStatus: { $in: ['failed', 'retrying'] },
        retryCount: { $lt: MAX_ATTEMPTS },
        nextRetryAt: { $lte: new Date() },
      })
        .limit(20)
        .exec();

      for (const log of due) {
        await retrySyncLog(log);
      }
    } catch (err) {
      // Never let a bad poll tick crash the process.
      console.error('linkedinLeadPoller job error:', err.message);
    }
  }, POLL_INTERVAL_MS);
}

module.exports = startLinkedInLeadPoller;
