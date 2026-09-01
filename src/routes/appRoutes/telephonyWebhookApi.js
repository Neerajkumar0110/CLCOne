const express = require('express');
const { catchErrors } = require('../../handlers/errorHandlers');
const c = require('../../controllers/appControllers/telephonyController');

// VPS → CRM webhook routes. Mounted at /api/telephony BEFORE the
// bearer-gated /api routers in app.js, and protected by telephonyHmacAuth
// (HMAC signature, not a CRM login). See spec §12–14.
const router = express.Router();

router.get('/health', catchErrors(c.health));
router.get('/replay-failed', catchErrors(c.replayEndpoint));

router.post('/events', catchErrors(c.ingest));
router.post('/call-status', catchErrors(c.callStatus));
router.post('/call-ended', catchErrors(c.callEnded));
router.post('/recording', catchErrors(c.recording));
router.post('/transfer', catchErrors(c.transfer));

module.exports = router;
