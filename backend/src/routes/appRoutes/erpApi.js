const express = require('express');
const multer = require('multer');
const { catchErrors } = require('../../handlers/errorHandlers');
const me = require('../../controllers/appControllers/hrms/erp/employee');
const ad = require('../../controllers/appControllers/hrms/erp/admin');
const ag = require('../../controllers/appControllers/hrms/erp/agent');

// Attendance ERP. Mounted in app.js:
//   /api/attendance-erp   behind isValidAuthToken (employee /me + admin /admin)
//   /api/erp-agent        /register behind isValidAuthToken, /beat by device token
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = express.Router();

// employee portal (/employee) — own data only
router.get('/me/today', catchErrors(me.today));
router.post('/me/start', catchErrors(me.start));
router.post('/me/heartbeat', catchErrors(me.heartbeat));
router.post('/me/break/start', catchErrors(me.breakStart));
router.post('/me/break/end', catchErrors(me.breakEnd));
router.post('/me/logout', catchErrors(me.logout));
router.get('/me/attendance', catchErrors(me.attendance));
router.get('/me/day', catchErrors(me.dayDetail));
router.get('/me/leaves', catchErrors(me.leaves));
router.post('/me/leaves', upload.single('attachment'), catchErrors(me.applyLeave));
router.post('/me/leaves/:id/cancel', catchErrors(me.cancelLeave));
router.get('/leaves/:id/attachment', catchErrors(me.attachment));
router.get('/me/calendar', catchErrors(me.calendar));
router.get('/me/profile', catchErrors(me.profile));
router.get('/me/notifications', catchErrors(me.notifications));
router.post('/me/notifications/read-all', catchErrors(me.notificationsReadAll));
router.get('/me/idle', catchErrors(me.idle));
router.post('/me/idle/:id/note', catchErrors(me.idleNote));
router.post('/me/review-note', catchErrors(me.reviewNote));
router.post('/me/report', catchErrors(me.report));
router.get('/me/agent', catchErrors(me.agent));
router.post('/me/agent/pair-code', catchErrors(ag.pairCode));
router.get('/me/agent/consent', catchErrors(me.agentConsentGet));
router.post('/me/agent/consent', catchErrors(me.agentConsentSet));

// admin (HRMS › Work & Leave Tracker › Attendance ERP) — each handler checks access
router.get('/admin/dashboard', catchErrors(ad.dashboard));
router.get('/admin/live', catchErrors(ad.live));
router.get('/admin/attendance', catchErrors(ad.attendance));
router.get('/admin/attendance/:adminId/day', catchErrors(ad.detail));
router.post('/admin/attendance/correct', catchErrors(ad.correct));
router.post('/admin/attendance/manual', catchErrors(ad.manual));
router.post('/admin/attendance/mark-leave', catchErrors(ad.markLeave));
router.get('/admin/leaves', catchErrors(ad.leaves));
router.post('/admin/leaves/:id/decide', catchErrors(ad.leaveDecide));
router.get('/admin/calendar', catchErrors(ad.calendar));
router.get('/admin/reports/monthly', catchErrors(ad.reportMonthly));
router.get('/admin/export', catchErrors(ad.exportFile));
router.get('/admin/employees', catchErrors(ad.employees));
router.get('/admin/employees-lite', catchErrors(ad.employeesLite));
router.put('/admin/employees/:id', catchErrors(ad.employeeUpdate));
router.post('/admin/invite/:id', catchErrors(ad.invite));
router.get('/admin/invites', catchErrors(ad.invites));
router.get('/admin/audit', catchErrors(ad.auditList));
router.get('/admin/notifications', catchErrors(ad.notifications));
router.post('/admin/notifications/read-all', catchErrors(ad.notificationsReadAll));
router.get('/admin/settings', catchErrors(ad.settingsGet));
router.put('/admin/settings', catchErrors(ad.settingsSave));
router.post('/admin/holidays', catchErrors(ad.holidayAdd));
router.post('/admin/holidays/:id/remove', catchErrors(ad.holidayRemove));
router.get('/admin/system', catchErrors(ad.system));
router.get('/admin/system/:adminId', catchErrors(ad.systemDay));
router.get('/admin/idle', catchErrors(ad.idleLog));
router.post('/admin/idle/:id/count', catchErrors(ad.idleCount));

const agentAuthed = express.Router();
agentAuthed.post('/register', catchErrors(ag.register));
const agentPublic = express.Router();
agentPublic.post('/beat', catchErrors(ag.beat));
agentPublic.post('/pair', catchErrors(ag.pair));
agentPublic.get('/download/:os', catchErrors(ag.download));

module.exports = { router, agentAuthed, agentPublic };
