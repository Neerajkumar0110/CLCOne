const express = require('express');
const rateLimit = require('express-rate-limit');
const { catchErrors } = require('../../handlers/errorHandlers');
const lms = require('../../controllers/appControllers/lmsController');

// Mounted at /api/lms/live — the two endpoints a browser hits WITHOUT a CRM
// bearer token during a live class:
//   GET  /t/:ticket   one-time redirect to the real meeting URL
//   *    /left         BBB logoutURL / leave beacon -> records left_at
// The ticket is single-use and short-lived; the real meeting URL is only ever
// exposed by the redirect, never in a JSON body or the frontend.
//
// Mounted BEFORE the bearer-gated /api routers in app.js.
const router = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 240 });

router.route('/t/:ticket').get(limiter, catchErrors(lms.liveTicket));
router.route('/open/:id').get(limiter, catchErrors(lms.liveOpenPublic));
router.route('/left').get(catchErrors(lms.liveLeftPing));
router.route('/left').post(catchErrors(lms.liveLeftPing));
router.route('/mock/:id').get(limiter, catchErrors(lms.liveMockRoom));

module.exports = router;
