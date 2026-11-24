const express = require('express');
const { catchErrors } = require('../../../handlers/errorHandlers');

// Public (no login) — mounted at /api/lms-public before the bearer gate.
//   GET /profile/:token     recruiter profile the learner shared (Figma 1D)
//   GET /verify-360/:code   check a downloaded 360° PDF is genuine (1F)
// The unguessable token / signed code is the access; the learner can revoke
// or expire a profile link at any time.
const router = express.Router();
const L = require('../../../controllers/appControllers/lms/lmsController/growth/learner360');

router.get('/profile/:token', catchErrors(L.publicProfile));
router.get('/verify-360/:code', catchErrors(L.verify360));

module.exports = router;
