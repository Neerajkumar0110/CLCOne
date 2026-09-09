const express = require('express');
const rateLimit = require('express-rate-limit');
const { catchErrors } = require('../../handlers/errorHandlers');
const lms = require('../../controllers/appControllers/lmsController');

// Mounted at /api/lms/webhooks — BigBlueButton event callbacks. Not CRM-
// bearer-authed (the BBB server has no CRM session); the handler checks a
// shared ?token= and/or BBB's checksum. Idempotent + logged.
// Mounted BEFORE the bearer-gated /api routers in app.js.
const router = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 1200 });

router.route('/bbb').get((req, res) => res.status(200).json({ success: true, message: 'bbb webhook up' }));
router.route('/bbb').post(limiter, catchErrors(lms.bbbWebhook));

module.exports = router;
