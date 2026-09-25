const express = require('express');
const crypto = require('crypto');
const { catchErrors } = require('../../handlers/errorHandlers');

// Mounted at /api/cron — before the bearer gate in app.js — as a safety net
// for a serverless deployment (backend/api/index.js on Vercel), where the
// setInterval-based workers started from src/server.js never fire because
// the process doesn't stay alive between requests. On the VPS/PM2 deployment
// those workers already run on their own; calling this endpoint there too is
// harmless — every job only acts on rows that are actually due.
//
// Auth: a shared secret, either as `Authorization: Bearer <CRON_SECRET>`
// (the header Vercel Cron sends automatically when CRON_SECRET is set on the
// project) or `?secret=<CRON_SECRET>` for manual/external cron pings. If
// CRON_SECRET isn't configured the endpoint refuses every request rather
// than running unauthenticated.
const router = express.Router();

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireCronSecret(req, res, next) {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    return res.status(503).json({ success: false, message: 'CRON_SECRET is not configured on this deployment.' });
  }
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const provided = bearer || req.query.secret;
  if (!timingSafeEqual(provided, configured)) {
    return res.status(401).json({ success: false, message: 'Invalid cron secret.' });
  }
  return next();
}

router.get(
  '/tick',
  requireCronSecret,
  catchErrors(async (req, res) => {
    const jobs = {
      lmsLiveTick: require('../../jobs/lmsLiveTick'),
      lmsSyncTick: require('../../jobs/lmsSyncTick'),
      lmsPolicyReminderTick: require('../../jobs/lmsPolicyReminderTick'),
      financeEmiTick: require('../../jobs/financeEmiTick'),
      lmsDailySummaryTick: require('../../jobs/lmsDailySummaryTick'),
    };
    const results = {};
    for (const [name, job] of Object.entries(jobs)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await job.runOnce();
        results[name] = 'ok';
      } catch (e) {
        results[name] = `error: ${e.message}`;
      }
    }
    return res.status(200).json({ success: true, results, at: new Date().toISOString() });
  })
);

module.exports = router;
