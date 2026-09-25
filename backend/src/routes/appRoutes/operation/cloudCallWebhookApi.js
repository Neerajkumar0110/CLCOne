const express = require('express');
const rateLimit = require('express-rate-limit');
const { catchErrors } = require('../../../handlers/errorHandlers');
const { cloudWebhook } = require('../../../controllers/appControllers/operation/callingController/cloudWebhook');
const { plivoAnswer } = require('../../../controllers/appControllers/operation/callingController/plivoAnswer');

// Mounted at /api/cloud-call — call-status callbacks from the cloud calling
// provider (Plivo). No CRM bearer token (the provider has no session); the
// controller checks a shared ?secret= / x-webhook-secret against
// CLOUD_CALL_WEBHOOK_SECRET. Mounted BEFORE the bearer-gated /api routers
// in app.js.
const router = express.Router();

const limiter = rateLimit({ windowMs: 60 * 1000, max: 600 });
router.route('/webhook').post(limiter, catchErrors(cloudWebhook));
router.route('/webhook').get((req, res) => res.status(200).json({ success: true, message: 'cloud-call webhook up' }));

// Plivo's answer_url — hit the instant the customer picks up; must return
// Plivo XML (not JSON), see plivoAnswer.js.
router.route('/plivo-answer').post(limiter, catchErrors(plivoAnswer));
router.route('/plivo-answer').get(limiter, catchErrors(plivoAnswer));

module.exports = router;
