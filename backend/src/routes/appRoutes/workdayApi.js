const express = require('express');
const { catchErrors } = require('../../handlers/errorHandlers');
const c = require('../../controllers/appControllers/hrms/workdayController');

// Mounted at /api/workday behind adminAuth.isValidAuthToken (see app.js).
// The header Login / break / leave widget, plus the management-only admin
// tracker (each admin handler checks the role itself).
const router = express.Router();

router.route('/me').get(catchErrors(c.me));
router.route('/login').post(catchErrors(c.login));
router.route('/logout').post(catchErrors(c.logout));
router.route('/break/start').post(catchErrors(c.breakStart));
router.route('/break/end').post(catchErrors(c.breakEnd));
router.route('/leave').post(catchErrors(c.leaveApply));
router.route('/leave/:id/cancel').post(catchErrors(c.leaveCancel));

router.route('/admin/board').get(catchErrors(c.board));
router.route('/admin/leaves').get(catchErrors(c.leaves));
router.route('/admin/leave/:id/decide').post(catchErrors(c.decide));
router.route('/admin/timeline').get(catchErrors(c.timeline));
router.route('/admin/report').get(catchErrors(c.report));

// Unauthenticated — the approver's one-click link from the leave email,
// protected by the per-request token instead (see publicDecision).
const publicRouter = express.Router();
publicRouter.route('/leave-decision').get(catchErrors(c.publicDecision));

module.exports = { router, publicRouter };
