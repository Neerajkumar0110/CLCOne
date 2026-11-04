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
router.route('/track').post(catchErrors(c.track));

router.route('/admin/board').get(catchErrors(c.board));
router.route('/admin/leaves').get(catchErrors(c.leaves));
router.route('/admin/leave/:id/decide').post(catchErrors(c.decide));
router.route('/admin/timeline').get(catchErrors(c.timeline));
router.route('/admin/report').get(catchErrors(c.report));
router.route('/admin/360').get(catchErrors(c.sales360));
router.route('/admin/360/search').get(catchErrors(c.sales360Search));
router.route('/admin/360/records').get(catchErrors(c.sales360Records));
router.route('/admin/360/calls').get(catchErrors(c.sales360Calls));
router.route('/admin/360/leads').get(catchErrors(c.sales360Leads));
router.route('/admin/360/lead-list').get(catchErrors(c.sales360LeadList));
router.route('/admin/360/leads-report').get(catchErrors(c.sales360LeadsReport));
router.route('/admin/360/export').get(catchErrors(c.sales360Export));
router.route('/admin/360/attendance').get(catchErrors(c.sales360Attendance));
router.route('/admin/360/exceptions').get(catchErrors(c.sales360Exceptions));
router.route('/admin/360/dialer-report').get(catchErrors(c.sales360DialerReport));
router.route('/admin/360/policy-days').get(catchErrors(c.sales360PolicyDays));
router.route('/admin/360/corrections').get(catchErrors(c.sales360Corrections));
router.route('/admin/360/correct').post(catchErrors(c.sales360Correct));
router.route('/admin/360/prospects').get(catchErrors(c.sales360Prospects));
router.route('/admin/360/prospects/:id/decide').post(catchErrors(c.sales360DecideProspect));
router.route('/admin/360/targets').get(catchErrors(c.sales360Targets));
router.route('/admin/360/target-detail').get(catchErrors(c.sales360TargetDetail));
router.route('/admin/360/backlog-waive').post(catchErrors(c.sales360WaiveBacklog));
router.route('/admin/360/roster').post(catchErrors(c.sales360Roster));
router.route('/admin/360/roster/cancel').post(catchErrors(c.sales360RosterCancel));
router.route('/admin/360/activity').get(catchErrors(c.sales360Activity));
router.route('/admin/360/overdue').get(catchErrors(c.overdueList));
router.route('/admin/360/overdue/record').post(catchErrors(c.overdueRecord));
router.route('/admin/360/overdue/:id/explain').post(catchErrors(c.overdueExplain));
router.route('/admin/360/overdue/:id/exclude').post(catchErrors(c.overdueExclude));
router.route('/admin/360/cases').get(catchErrors(c.caseList)).post(catchErrors(c.caseCreate));
router.route('/admin/360/cases/:id/decide').post(catchErrors(c.caseDecide));
router.route('/admin/360/outages').get(catchErrors(c.outageList)).post(catchErrors(c.outageCreate));
router.route('/admin/360/outages/:id/remove').post(catchErrors(c.outageRemove));
router.route('/admin/mark-present').post(catchErrors(c.markPresent));
router.route('/admin/remind-login').post(catchErrors(c.remindLogin));

// Unauthenticated — the approver's one-click link from the leave email,
// protected by the per-request token instead (see publicDecision).
const publicRouter = express.Router();
publicRouter.route('/leave-decision').get(catchErrors(c.publicDecision));

module.exports = { router, publicRouter };
