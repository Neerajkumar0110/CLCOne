const express = require('express');
const rateLimit = require('express-rate-limit');
const { catchErrors } = require('../../handlers/errorHandlers');
const moodleWebhookAuth = require('../../middlewares/moodleWebhookAuth');
const lms = require('../../controllers/appControllers/lmsController');

// Mounted at /api/lms/webhook — events from Moodle's local_crmbridge plugin.
// No CRM bearer token (Moodle has no session); every request is HMAC-signed
// and (optionally) IP-checked by moodleWebhookAuth. Mounted BEFORE the
// bearer-gated /api routers in app.js, same as the telephony webhook.
const router = express.Router();

const limiter = rateLimit({ windowMs: 60 * 1000, max: 1200 });

router.route('/moodle').get((req, res) => res.status(200).json({ success: true, message: 'lms webhook up' }));
router.route('/moodle').post(limiter, moodleWebhookAuth, catchErrors(lms.webhookReceive));

module.exports = router;
