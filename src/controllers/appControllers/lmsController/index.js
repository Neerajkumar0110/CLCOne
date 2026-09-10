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
