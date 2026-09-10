const express = require('express');
const { catchErrors } = require('../../handlers/errorHandlers');
const lms = require('../../controllers/appControllers/lmsController');
const { requireManager } = require('../../controllers/appControllers/lmsController/permissions');

// Mounted at /api/lms — behind adminAuth.isValidAuthToken (see app.js), so
// req.admin is always set. The inbound Moodle webhook is a separate router
// (lmsWebhookApi.js) mounted before the bearer gate.
const router = express.Router();

// ── SSO (current user) ────────────────────────────────────────────────
router.route('/sso/login-url').get(catchErrors(lms.ssoLoginUrl));
router.route('/sso/logout-url').get(catchErrors(lms.ssoLogoutUrl));

// ── live classes (auto meeting rooms) — self-scoped by role ──────────
// Two path spellings for the same handlers: /liveclasses (legacy) and
// /live-classes (spec §30). Register both.
['/liveclasses', '/live-classes'].forEach((base) => {
  router.route(base).get(catchErrors(lms.liveList));
  router.route(base).post(requireManager, catchErrors(lms.liveCreate));
  router.route(`${base}/:id`).get(catchErrors(lms.liveGet));
  router.route(`${base}/:id`).patch(catchErrors(lms.liveUpdateTime));
  router.route(`${base}/:id/start`).post(catchErrors(lms.liveStart));
  router.route(`${base}/:id/end`).post(catchErrors(lms.liveEnd));
  router.route(`${base}/:id/join`).post(catchErrors(lms.liveJoin));
  router.route(`${base}/:id/join/teacher`).post(catchErrors(lms.liveJoin));
  router.route(`${base}/:id/join/student`).post(catchErrors(lms.liveJoin));
  router.route(`${base}/:id/leave`).post(catchErrors(lms.liveLeave));
  router.route(`${base}/:id/attendance`).get(catchErrors(lms.liveAttendance));
  router.route(`${base}/:id/regenerate`).post(requireManager, catchErrors(lms.liveRegenerate));
  router.route(`${base}/:id/open`).get(catchErrors(lms.liveOpenEntry));
});

// ── add a student to a running batch (manager, or the batch's teacher) ──
router.route('/batches/:id/students').post(catchErrors(lms.liveAddStudent));

// ── curriculum builder (Course → Module → Chapter → Lesson) — teacher/manager ──
router.route('/courses/:courseId/outline').get(catchErrors(lms.curriculumOutline));
router.route('/courses/:courseId/modules').post(catchErrors(lms.curriculumAddModule));
router.route('/courses/:courseId/reorder').post(catchErrors(lms.curriculumReorder));
router.route('/modules/:id').patch(catchErrors(lms.curriculumUpdateModule)).delete(catchErrors(lms.curriculumDeleteModule));
router.route('/modules/:id/chapters').post(catchErrors(lms.curriculumAddChapter));
router.route('/chapters/:id').patch(catchErrors(lms.curriculumUpdateChapter)).delete(catchErrors(lms.curriculumDeleteChapter));
router.route('/chapters/:id/lessons').post(catchErrors(lms.curriculumAddLesson));
router.route('/lessons/:id').patch(catchErrors(lms.curriculumUpdateLesson)).delete(catchErrors(lms.curriculumDeleteLesson));

// ── student learning surface ────────────────────────────────────────
router.route('/learn').get(catchErrors(lms.learnMyCourses));
router.route('/learn/:courseId').get(catchErrors(lms.learnCourseOutline));
router.route('/lessons/:id/view').get(catchErrors(lms.learnLessonDetail));
router.route('/lessons/:id/progress').post(catchErrors(lms.learnSaveProgress));
router.route('/lessons/:id/complete').post(catchErrors(lms.learnMarkComplete));

// ── assignments ─────────────────────────────────────────────────────
router.route('/assignments').get(catchErrors(lms.assignmentList)).post(catchErrors(lms.assignmentCreate));
router.route('/my/assignments').get(catchErrors(lms.assignmentMyList));
router.route('/assignments/:id').get(catchErrors(lms.assignmentGet)).patch(catchErrors(lms.assignmentUpdate)).delete(catchErrors(lms.assignmentDelete));
router.route('/assignments/:id/submissions').get(catchErrors(lms.assignmentSubmissions));
router.route('/assignments/:id/submit').post(catchErrors(lms.assignmentSubmit));
router.route('/submissions/:id/evaluate').post(catchErrors(lms.assignmentEvaluate));

// ── quizzes / exams / question bank ─────────────────────────────────
router.route('/quizzes').get(catchErrors(lms.quizList)).post(catchErrors(lms.quizCreate));
router.route('/my/quizzes').get(catchErrors(lms.quizMyList));
router.route('/question-bank').get(catchErrors(lms.quizQuestionBank));
router.route('/quizzes/:id').get(catchErrors(lms.quizGet)).patch(catchErrors(lms.quizUpdate)).delete(catchErrors(lms.quizDelete));
router.route('/quizzes/:id/questions').post(catchErrors(lms.quizAddQuestion));
router.route('/quizzes/:id/start').post(catchErrors(lms.quizStart));
router.route('/quizzes/:id/results').get(catchErrors(lms.quizResults));
router.route('/questions/:id').patch(catchErrors(lms.quizUpdateQuestion)).delete(catchErrors(lms.quizDeleteQuestion));
router.route('/attempts/:id/submit').post(catchErrors(lms.quizSubmit));
router.route('/attempts/:id/result').get(catchErrors(lms.quizAttemptResult));
router.route('/attempts/:id/evaluate').post(catchErrors(lms.quizEvaluateAttempt));

// ── recordings (role-scoped inside the handler) ─────────────────────
router.route('/recordings').get(catchErrors(lms.liveRecordings));
router.route('/recordings/:id/play').get(catchErrors(lms.liveRecordingPlay));

// ── student self-service ───────────────────────────────────────────
router.route('/student/live-classes').get(catchErrors(lms.studentLiveClasses));
router.route('/student/recordings').get(catchErrors(lms.liveRecordings));
router.route('/student/attendance').get(catchErrors(lms.studentAttendance));

// ── teacher ────────────────────────────────────────────────────────
router.route('/teacher/dashboard').get(catchErrors(lms.teacherDashboard));
router.route('/teacher/analytics').get(catchErrors(lms.teacherAnalytics));
router.route('/student/dashboard').get(catchErrors(lms.studentDashboard));

// ── doubts (Q&A) ───────────────────────────────────────────────────
router.route('/doubts').get(catchErrors(lms.doubtList)).post(catchErrors(lms.doubtAsk));
router.route('/doubts/:id').get(catchErrors(lms.doubtGet));
router.route('/doubts/:id/reply').post(catchErrors(lms.doubtReply));
router.route('/doubts/:id/resolve').post(catchErrors(lms.doubtResolve));
router.route('/doubts/:id/pin').post(catchErrors(lms.doubtPin));

// ── announcements ──────────────────────────────────────────────────
router.route('/announcements').get(catchErrors(lms.announcementList)).post(catchErrors(lms.announcementCreate));
router.route('/announcements/:id').delete(catchErrors(lms.announcementDelete));
router.route('/my/announcements').get(catchErrors(lms.announcementMine));

// ── certificates ───────────────────────────────────────────────────
router.route('/courses/:courseId/certificate-rule').get(catchErrors(lms.certRuleGet)).post(catchErrors(lms.certRuleUpsert));
router.route('/certificates').get(catchErrors(lms.certHistory));
router.route('/certificates/issue').post(catchErrors(lms.certIssue));
router.route('/certificates/run/:courseId').post(catchErrors(lms.certRunForCourse));
router.route('/certificates/verify/:certificateId').get(catchErrors(lms.certVerify));
router.route('/my/certificates').get(catchErrors(lms.certMine));
router.route('/teacher/live-classes').get(catchErrors(lms.liveList));
router.route('/teacher/recordings').get(catchErrors(lms.liveRecordings));
router.route('/teacher/attendance').get(catchErrors(lms.liveAttendanceDashboard));
router.route('/teacher/attendance/export').get(catchErrors(lms.liveAttendanceExport));

// ── student portal (self-scoped) ─────────────────────────────────────
router.route('/portal/config').get(catchErrors(lms.portalConfig));
router.route('/portal/me').get(catchErrors(lms.portalMe));
router.route('/portal/my-courses').get(catchErrors(lms.portalMyCourses));
router.route('/portal/course/:moodleCourseId').get(catchErrors(lms.portalCourse));
router.route('/portal/calendar').get(catchErrors(lms.portalCalendar));

// ── integration ops (management only) ───────────────────────────────
router.route('/admin/status').get(requireManager, catchErrors(lms.adminStatus));
router.route('/admin/test-connection').post(requireManager, catchErrors(lms.adminTestConnection));
router.route('/admin/webhook-selftest').post(requireManager, catchErrors(lms.adminWebhookSelftest));
router.route('/admin/sync-user/:id').post(requireManager, catchErrors(lms.adminSyncUser));
router.route('/admin/sync-course/:id').post(requireManager, catchErrors(lms.adminSyncCourse));
router.route('/admin/enrol').post(requireManager, catchErrors(lms.adminEnrol));
router.route('/admin/unenrol').post(requireManager, catchErrors(lms.adminUnenrol));
router.route('/admin/mappings').get(requireManager, catchErrors(lms.adminMappings));
router.route('/admin/reconcile').post(requireManager, catchErrors(lms.adminReconcile));
router.route('/admin/jobs').get(requireManager, catchErrors(lms.adminJobs));
router.route('/admin/jobs/:id/retry').post(requireManager, catchErrors(lms.adminRetryJob));
router.route('/admin/events').get(requireManager, catchErrors(lms.adminEvents));
router.route('/admin/provision-all').post(requireManager, catchErrors(lms.adminProvisionAll));

// ── admin live-class management ────────────────────────────────────
router.route('/admin/attendance').get(requireManager, catchErrors(lms.liveAttendanceDashboard));
router.route('/admin/attendance/export').get(requireManager, catchErrors(lms.liveAttendanceExport));
router.route('/admin/recordings').get(requireManager, catchErrors(lms.liveRecordings));
router.route('/admin/recordings/:id/delete').post(requireManager, catchErrors(lms.liveRecordingDelete));
router.route('/admin/live-monitor').get(requireManager, catchErrors(lms.liveMonitor));
router.route('/admin/live-analytics').get(requireManager, catchErrors(lms.liveAnalytics));
router.route('/admin/live-settings').get(requireManager, catchErrors(lms.liveSettingsGet));
router.route('/admin/live-settings').post(requireManager, catchErrors(lms.liveSettingsUpdate));

// ── PILOT / internal test (management only) — see deploy/moodle/PILOT.md ──
router.route('/admin/pilot/seed').post(requireManager, catchErrors(lms.pilotSeed));
router.route('/admin/pilot/liveclass/:id/start').post(requireManager, catchErrors(lms.pilotLiveStart));
router.route('/admin/pilot/liveclass/:id/join').post(requireManager, catchErrors(lms.pilotLiveJoin));
router.route('/admin/pilot/liveclass/:id/leave').post(requireManager, catchErrors(lms.pilotLiveLeave));
router.route('/admin/pilot/liveclass/:id/end').post(requireManager, catchErrors(lms.pilotLiveEnd));
router.route('/admin/pilot/sso-link').post(requireManager, catchErrors(lms.pilotSsoLink));
router.route('/admin/pilot/status/:sessionId').get(requireManager, catchErrors(lms.pilotStatus));
router.route('/admin/pilot/teardown').post(requireManager, catchErrors(lms.pilotTeardown));

module.exports = router;
