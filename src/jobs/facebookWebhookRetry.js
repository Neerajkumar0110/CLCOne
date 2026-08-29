const mongoose = require('mongoose');

// No queue/job infra exists anywhere in this app (confirmed: no bull/agenda/
// node-cron) — this is a minimal in-process poller for failed webhook leads,
// appropriate given the app's current single-instance deployment shape.
// Exponential backoff is already computed on the log by webhook.js's
// processWebhookLog; this just re-invokes it once nextRetryAt has passed.
const POLL_INTERVAL_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function startFacebookWebhookRetryJob() {
  setInterval(async () => {
    try {
      const FacebookWebhookLog = mongoose.model('FacebookWebhookLog');
      const { processWebhookLog } = require('../controllers/appControllers/facebookController/webhook');

      const due = await FacebookWebhookLog.find({
        removed: false,
        processingStatus: { $in: ['failed', 'retrying'] },
        retryCount: { $lt: MAX_ATTEMPTS },
        nextRetryAt: { $lte: new Date() },
      })
        .limit(20)
        .exec();

      for (const log of due) {
        await processWebhookLog(log);
      }
    } catch (err) {
      // Never let a bad poll tick crash the process.
      console.error('facebookWebhookRetry job error:', err.message);
    }
  }, POLL_INTERVAL_MS);
}

module.exports = startFacebookWebhookRetryJob;
