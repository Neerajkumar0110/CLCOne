import axios from 'axios';
import { request } from '@/request';
import { API_BASE_URL } from '@/config/serverApiConfig';
import storePersist from '@/redux/storePersist';

// Thin client for the CRM's /api/lms/* endpoints (backend: routes/appRoutes/
// lmsApi.js). request.get returns the raw { success, result } envelope.

const qs = (o = {}) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
};

const lmsApi = {
  portalConfig: () => request.get({ entity: 'lms/portal/config' }),
  me: () => request.get({ entity: 'lms/portal/me' }),
  myCourses: () => request.get({ entity: 'lms/portal/my-courses' }),
  course: (moodleCourseId) => request.get({ entity: `lms/portal/course/${moodleCourseId}` }),
  calendar: ({ from, to } = {}) => request.get({ entity: `lms/portal/calendar${qs({ from, to })}` }),
  ssoLoginUrl: (wantsurl) =>
    request.get({ entity: `lms/sso/login-url${wantsurl ? `?wantsurl=${encodeURIComponent(wantsurl)}` : ''}` }),

  // ── live classes (auto meeting rooms) ──────────────────────────────
  liveClasses: (scope) => request.get({ entity: `lms/live-classes${qs({ scope })}` }),
  liveClass: (id) => request.get({ entity: `lms/live-classes/${id}` }),
  // teacher / manager: set or edit a class's scheduled start + duration
  // ({ scheduledStart, scheduledDurationMin, autoStartAt, title }).
  liveClassUpdate: (id, patch) => request.patch({ entity: `lms/live-classes/${id}`, jsonData: patch }),
  // manager / batch teacher: add a student to a running batch (same link + email).
  addBatchStudent: (batchId, jsonData) =>
    request.post({ entity: `lms/batches/${batchId}/students`, jsonData }),
  // combined search across the LMS Student roster + User Management (Admin, role=Student) accounts.
  searchStudents: (q) => request.get({ entity: `lms/students/search${qs({ q })}` }),
  listBatchStudents: (batchId) => request.get({ entity: `lms/batches/${batchId}/students` }),
  removeBatchStudent: (batchId, jsonData) =>
    request.post({ entity: `lms/batches/${batchId}/students/remove`, jsonData }),
  liveClassStart: (id) => request.post({ entity: `lms/live-classes/${id}/start`, jsonData: {} }),
  liveClassEnd: (id) => request.post({ entity: `lms/live-classes/${id}/end`, jsonData: {} }),
  liveClassJoin: (id) => request.post({ entity: `lms/live-classes/${id}/join`, jsonData: {} }),
  liveClassLeave: (id) => request.post({ entity: `lms/live-classes/${id}/leave`, jsonData: {} }),
  liveClassAttendance: (id) => request.get({ entity: `lms/live-classes/${id}/attendance` }),
  liveClassRegenerate: (id, batchId) =>
    request.post({ entity: `lms/live-classes/${id}/regenerate`, jsonData: { batchId } }),
  // liveClassJoin() returns a one-time ticket URL (`/api/lms/live/t/:ticket`,
  // mounted unauthenticated in lmsLivePublicApi.js). For Jitsi we redeem that
  // same ticket a second way — `?embed=1` — to get JSON embed config instead
  // of following the redirect, so the meeting can be mounted in-app
  // (frontend/src/pages/Lms/components/JitsiEmbed.jsx) instead of opening a
  // new tab. Ticket is single-use, so this must be the only redemption.
  liveTicketEmbed: (ticketUrl) => {
    const m = /\/lms\/live\/t\/([^/?#]+)/.exec(ticketUrl || '');
    const ticket = m ? m[1] : ticketUrl;
    return request.get({ entity: `lms/live/t/${ticket}?embed=1` });
  },

  // ── recordings ────────────────────────────────────────────────────
  recordings: (f = {}) => request.get({ entity: `lms/recordings${qs(f)}` }),
  adminRecordings: (f = {}) => request.get({ entity: `lms/admin/recordings${qs(f)}` }),
  teacherRecordings: (f = {}) => request.get({ entity: `lms/teacher/recordings${qs(f)}` }),
  studentRecordings: (f = {}) => request.get({ entity: `lms/student/recordings${qs(f)}` }),
  recordingPlay: (id) => request.get({ entity: `lms/recordings/${id}/play` }),
  recordingDelete: (id) => request.post({ entity: `lms/admin/recordings/${id}/delete`, jsonData: {} }),

  // ── attendance ────────────────────────────────────────────────────
  adminAttendance: (f = {}) => request.get({ entity: `lms/admin/attendance${qs(f)}` }),
  teacherAttendance: (f = {}) => request.get({ entity: `lms/teacher/attendance${qs(f)}` }),
  studentAttendance: (f = {}) => request.get({ entity: `lms/student/attendance${qs(f)}` }),
  // export -> fetch the file with the bearer, then trigger a client download
  attendanceExport: async (role, f = {}) => {
    let token = '';
    try {
      token = storePersist.get('auth')?.current?.token || '';
    } catch (e) {
      /* noop */
    }
    const format = f.format || 'csv';
    const res = await axios.get(`${API_BASE_URL}lms/${role}/attendance/export${qs(f)}`, {
      responseType: 'blob',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance.${format === 'xlsx' ? 'xlsx' : 'csv'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  // ── admin live-class management ───────────────────────────────────
  liveMonitor: () => request.get({ entity: 'lms/admin/live-monitor' }),
  liveAnalytics: () => request.get({ entity: 'lms/admin/live-analytics' }),
  liveSettings: () => request.get({ entity: 'lms/admin/live-settings' }),
  liveSettingsSave: (patch) => request.post({ entity: 'lms/admin/live-settings', jsonData: patch }),

  adminStatus: () => request.get({ entity: 'lms/admin/status' }),

  // ── dedicated panels ─────────────────────────────────────────────
  teacherDashboard: (f = {}) => request.get({ entity: `lms/teacher/dashboard${qs(f)}` }),
  studentDashboard: (f = {}) => request.get({ entity: `lms/student/dashboard${qs(f)}` }),

  // ── curriculum builder (teacher) ─────────────────────────────────
  courseOutline: (courseId) => request.get({ entity: `lms/courses/${courseId}/outline` }),
  addModule: (courseId, body) => request.post({ entity: `lms/courses/${courseId}/modules`, jsonData: body }),
  updateModule: (id, body) => request.patch({ entity: `lms/modules/${id}`, jsonData: body }),
  deleteModule: (id) => request.del({ entity: `lms/modules/${id}` }),
  addChapter: (moduleId, body) => request.post({ entity: `lms/modules/${moduleId}/chapters`, jsonData: body }),
  updateChapter: (id, body) => request.patch({ entity: `lms/chapters/${id}`, jsonData: body }),
  deleteChapter: (id) => request.del({ entity: `lms/chapters/${id}` }),
  addLesson: (chapterId, body) => request.post({ entity: `lms/chapters/${chapterId}/lessons`, jsonData: body }),
  updateLesson: (id, body) => request.patch({ entity: `lms/lessons/${id}`, jsonData: body }),
  deleteLesson: (id) => request.del({ entity: `lms/lessons/${id}` }),
  reorderCurriculum: (courseId, body) => request.post({ entity: `lms/courses/${courseId}/reorder`, jsonData: body }),

  // ── learning surface (student) ──────────────────────────────────
  myLearnCourses: () => request.get({ entity: 'lms/learn' }),
  learnCourse: (courseId) => request.get({ entity: `lms/learn/${courseId}` }),
  lessonView: (id) => request.get({ entity: `lms/lessons/${id}/view` }),
  lessonProgress: (id, body) => request.post({ entity: `lms/lessons/${id}/progress`, jsonData: body }),
  lessonComplete: (id) => request.post({ entity: `lms/lessons/${id}/complete`, jsonData: {} }),

  // ── assignments ─────────────────────────────────────────────────
  assignments: (f = {}) => request.get({ entity: `lms/assignments${qs(f)}` }),
  createAssignment: (b) => request.post({ entity: 'lms/assignments', jsonData: b }),
  updateAssignment: (id, b) => request.patch({ entity: `lms/assignments/${id}`, jsonData: b }),
  deleteAssignment: (id) => request.del({ entity: `lms/assignments/${id}` }),
  assignmentSubmissions: (id) => request.get({ entity: `lms/assignments/${id}/submissions` }),
  evaluateSubmission: (id, b) => request.post({ entity: `lms/submissions/${id}/evaluate`, jsonData: b }),
  myAssignments: () => request.get({ entity: 'lms/my/assignments' }),
  submitAssignment: (id, b) => request.post({ entity: `lms/assignments/${id}/submit`, jsonData: b }),

  // ── quizzes / exams ────────────────────────────────────────────
  quizzes: (f = {}) => request.get({ entity: `lms/quizzes${qs(f)}` }),
  createQuiz: (b) => request.post({ entity: 'lms/quizzes', jsonData: b }),
  quiz: (id) => request.get({ entity: `lms/quizzes/${id}` }),
  updateQuiz: (id, b) => request.patch({ entity: `lms/quizzes/${id}`, jsonData: b }),
  deleteQuiz: (id) => request.del({ entity: `lms/quizzes/${id}` }),
  addQuestion: (quizId, b) => request.post({ entity: `lms/quizzes/${quizId}/questions`, jsonData: b }),
  updateQuestion: (id, b) => request.patch({ entity: `lms/questions/${id}`, jsonData: b }),
  deleteQuestion: (id) => request.del({ entity: `lms/questions/${id}` }),
  quizResults: (id) => request.get({ entity: `lms/quizzes/${id}/results` }),
  evaluateAttempt: (id, b) => request.post({ entity: `lms/attempts/${id}/evaluate`, jsonData: b }),
  questionBank: (f = {}) => request.get({ entity: `lms/question-bank${qs(f)}` }),
  myQuizzes: () => request.get({ entity: 'lms/my/quizzes' }),
  startQuiz: (id) => request.post({ entity: `lms/quizzes/${id}/start`, jsonData: {} }),
  submitQuizAttempt: (id, b) => request.post({ entity: `lms/attempts/${id}/submit`, jsonData: b }),
  attemptResult: (id) => request.get({ entity: `lms/attempts/${id}/result` }),

  // ── doubts ─────────────────────────────────────────────────────
  doubts: (f = {}) => request.get({ entity: `lms/doubts${qs(f)}` }),
  askDoubt: (b) => request.post({ entity: 'lms/doubts', jsonData: b }),
  doubt: (id) => request.get({ entity: `lms/doubts/${id}` }),
  replyDoubt: (id, b) => request.post({ entity: `lms/doubts/${id}/reply`, jsonData: b }),
  resolveDoubt: (id, b = {}) => request.post({ entity: `lms/doubts/${id}/resolve`, jsonData: b }),
  pinDoubt: (id) => request.post({ entity: `lms/doubts/${id}/pin`, jsonData: {} }),

  // ── announcements ──────────────────────────────────────────────
  announcements: () => request.get({ entity: 'lms/announcements' }),
  createAnnouncement: (b) => request.post({ entity: 'lms/announcements', jsonData: b }),
  deleteAnnouncement: (id) => request.del({ entity: `lms/announcements/${id}` }),
  myAnnouncements: () => request.get({ entity: 'lms/my/announcements' }),

  // ── certificates ──────────────────────────────────────────────
  certRule: (courseId) => request.get({ entity: `lms/courses/${courseId}/certificate-rule` }),
  saveCertRule: (courseId, b) => request.post({ entity: `lms/courses/${courseId}/certificate-rule`, jsonData: b }),
  issueCertificate: (b) => request.post({ entity: 'lms/certificates/issue', jsonData: b }),
  runCertificates: (courseId) => request.post({ entity: `lms/certificates/run/${courseId}`, jsonData: {} }),
  certHistory: (f = {}) => request.get({ entity: `lms/certificates${qs(f)}` }),
  myCertificates: () => request.get({ entity: 'lms/my/certificates' }),
  verifyCertificate: (cid) => request.get({ entity: `lms/certificates/verify/${cid}` }),

  // ── analytics ─────────────────────────────────────────────────
  teacherAnalytics: (f = {}) => request.get({ entity: `lms/teacher/analytics${qs(f)}` }),
  teacherLiveAnalytics: (f = {}) => request.get({ entity: `lms/teacher/live-analytics${qs(f)}` }),

  // ── panel real-time poll ─────────────────────────────────────
  updates: () => request.get({ entity: 'lms/my/updates' }),
};

export default lmsApi;
