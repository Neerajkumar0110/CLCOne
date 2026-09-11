// LMS controller — thin HTTP layer over services/lms. Nothing here talks to
// Moodle directly; it all goes through syncService / MoodleClient.
const webhook = require('./webhook');
const sso = require('./sso');
const portal = require('./portal');
const admin = require('./admin');
const pilot = require('./pilot');
const liveclass = require('./liveclass');
const scope = require('./liveScope');
const bbbWebhook = require('./bbbWebhook');
const panel = require('./panel');
const curriculum = require('./curriculum');
const learning = require('./learning');
const assignments = require('./assignments');
const quizzes = require('./quizzes');
const engagement = require('./engagement');
const certificates = require('./certificates');
const analytics = require('./analytics');

module.exports = {
  // inbound webhook (mounted before the bearer gate, HMAC-verified)
  webhookReceive: webhook.receive,
  processEvent: webhook.processEvent, // reused by jobs/lmsSyncTick.js

  // sso
  ssoLoginUrl: sso.loginUrl,
  ssoLogoutUrl: sso.logoutUrl,

  // student portal
  portalConfig: portal.config,
  portalMe: portal.me,
  portalMyCourses: portal.myCourses,
  portalCourse: portal.course,
  portalCalendar: portal.calendar,

  // admin / ops
  adminStatus: admin.status,
  adminTestConnection: admin.testConnection,
  adminSyncUser: admin.syncUser,
  adminSyncCourse: admin.syncCourse,
  adminEnrol: admin.enrol,
  adminUnenrol: admin.unenrol,
  adminMappings: admin.mappings,
  adminWebhookSelftest: admin.webhookSelftest,
  adminReconcile: admin.reconcileNow,
  adminJobs: admin.jobs,
  adminEvents: admin.events,
  adminRetryJob: admin.retryJob,
  adminProvisionAll: admin.provisionAll,

  // pilot / internal test (management-gated)
  pilotSeed: pilot.seed,
  pilotLiveStart: pilot.liveStart,
  pilotLiveJoin: pilot.liveJoin,
  pilotLiveLeave: pilot.liveLeave,
  pilotLiveEnd: pilot.liveEnd,
  pilotSsoLink: pilot.ssoLink,
  pilotStatus: pilot.pilotStatus,
  pilotTeardown: pilot.teardown,
  // live classes (auto meeting rooms, lifecycle, attendance)
  liveList: liveclass.list,
  liveGet: liveclass.get,
  liveCreate: liveclass.create,
  liveUpdateTime: liveclass.updateTime,
  liveAddStudent: liveclass.addStudent,
  studentSearch: liveclass.studentSearch,
  batchStudents: liveclass.batchStudents,
  removeBatchStudent: liveclass.removeStudent,
  liveStart: liveclass.start,
  liveEnd: liveclass.end,
  liveJoin: liveclass.join,
  liveLeave: liveclass.leave,
  liveAttendance: liveclass.attendance,
  liveOpenEntry: liveclass.openEntry,
  liveRegenerate: liveclass.regenerate,
  // pre-bearer
  liveTicket: liveclass.ticket,
  liveOpenPublic: liveclass.openPublic,
  liveLeftPing: liveclass.left,
  liveMockRoom: liveclass.mockRoom,
  bbbWebhook: bbbWebhook.receive,

  // dedicated LMS panels (Teacher / Student)
  teacherDashboard: panel.teacherDashboard,
  studentDashboard: panel.studentDashboard,
  lmsMyUpdates: panel.myUpdates,
  teacherLiveAnalytics: panel.teacherLiveAnalytics,

  // curriculum builder (Course -> Module -> Chapter -> Lesson) — teacher/manager
  curriculumOutline: curriculum.outline,
  curriculumAddModule: curriculum.addModule,
  curriculumUpdateModule: curriculum.updateModule,
  curriculumDeleteModule: curriculum.deleteModule,
  curriculumAddChapter: curriculum.addChapter,
  curriculumUpdateChapter: curriculum.updateChapter,
  curriculumDeleteChapter: curriculum.deleteChapter,
  curriculumAddLesson: curriculum.addLesson,
  curriculumUpdateLesson: curriculum.updateLesson,
  curriculumDeleteLesson: curriculum.deleteLesson,
  curriculumReorder: curriculum.reorder,

  // student learning surface (outline + progress)
  learnMyCourses: learning.myCourses,
  learnCourseOutline: learning.courseOutline,
  learnLessonDetail: learning.lessonDetail,
  learnSaveProgress: learning.saveProgress,
  learnMarkComplete: learning.markComplete,

  // assignments
  assignmentCreate: assignments.create,
  assignmentList: assignments.list,
  assignmentGet: assignments.getOne,
  assignmentUpdate: assignments.update,
  assignmentDelete: assignments.remove,
  assignmentSubmissions: assignments.submissions,
  assignmentEvaluate: assignments.evaluate,
  assignmentMyList: assignments.myList,
  assignmentSubmit: assignments.submit,

  // quizzes / exams / question bank
  quizCreate: quizzes.createQuiz,
  quizList: quizzes.listQuizzes,
  quizGet: quizzes.getQuiz,
  quizUpdate: quizzes.updateQuiz,
  quizDelete: quizzes.deleteQuiz,
  quizAddQuestion: quizzes.addQuestion,
  quizUpdateQuestion: quizzes.updateQuestion,
  quizDeleteQuestion: quizzes.deleteQuestion,
  quizQuestionBank: quizzes.questionBank,
  quizMyList: quizzes.myQuizzes,
  quizStart: quizzes.startAttempt,
  quizSubmit: quizzes.submitAttempt,
  quizAttemptResult: quizzes.attemptResult,
  quizResults: quizzes.quizResults,
  quizEvaluateAttempt: quizzes.evaluateAttempt,

  // doubts
  doubtAsk: engagement.askDoubt,
  doubtList: engagement.listDoubts,
  doubtGet: engagement.getDoubt,
  doubtReply: engagement.replyDoubt,
  doubtResolve: engagement.resolveDoubt,
  doubtPin: engagement.pinDoubt,

  // announcements
  announcementCreate: engagement.createAnnouncement,
  announcementList: engagement.listAnnouncements,
  announcementDelete: engagement.deleteAnnouncement,
  announcementMine: engagement.myAnnouncements,

  // certificates
  certRuleGet: certificates.getRule,
  certRuleUpsert: certificates.upsertRule,
  certIssue: certificates.issue,
  certRunForCourse: certificates.runForCourse,
  certHistory: certificates.history,
  certMine: certificates.mine,
  certVerify: certificates.verify,

  // analytics
  teacherAnalytics: analytics.teacherAnalytics,

  // role-scoped reads
  studentLiveClasses: scope.studentLiveClasses,
  studentAttendance: scope.studentAttendance,
  liveRecordings: scope.listRecordings,
  liveRecordingPlay: scope.playRecording,
  liveRecordingDelete: scope.deleteRecording,
  liveAttendanceDashboard: scope.attendanceDashboard,
  liveAttendanceExport: scope.attendanceExport,
  liveMonitor: scope.liveMonitor,
  liveAnalytics: scope.analytics,
  liveSettingsGet: scope.getSettings,
  liveSettingsUpdate: scope.updateSettings,
};
