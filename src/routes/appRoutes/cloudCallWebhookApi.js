const express = require('express');
const rateLimit = require('express-rate-limit');
const { catchErrors } = require('../../handlers/errorHandlers');
const { cloudWebhook } = require('../../controllers/appControllers/callingController/cloudWebhook');

// Mounted at /api/cloud-call — call-status callbacks from the cloud calling
// provider (Tata Smartflo / Exotel / …). No CRM bearer token (the provider
// has no session); the controller checks a shared ?secret= / x-webhook-secret
// against CLOUD_CALL_WEBHOOK_SECRET. Mounted BEFORE the bearer-gated /api
// routers in app.js, same as the telephony webhook.
const router = express.Router();

const limiter = rateLimit({ windowMs: 60 * 1000, max: 600 });
router.route('/webhook').post(limiter, catchErrors(cloudWebhook));
router.route('/webhook').get((req, res) => res.status(200).json({ success: true, message: 'cloud-call webhook up' }));

module.exports = router;
