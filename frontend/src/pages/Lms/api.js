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
  // Every session (any status) whose scheduledStart falls in [from, to] —
  // uncollapsed (unlike the default/scope view, which shows one card per
  // batch) — e.g. a calendar month grid, or a batch's own upcoming list.
  liveClassesRange: (from, to) => request.get({ entity: `lms/live-classes${qs({ scope: 'all', from, to })}` }),
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

  // ── recordings ────────────────────────────────────────────────────
  recordings: (f = {}) => request.get({ entity: `lms/recordings${qs(f)}` }),
  adminRecordings: (f = {}) => request.get({ entity: `lms/admin/recordings${qs(f)}` }),
  teacherRecordings: (f = {}) => request.get({ entity: `lms/teacher/recordings${qs(f)}` }),
  studentRecordings: (f = {}) => request.get({ entity: `lms/student/recordings${qs(f)}` }),
  recordingPlay: (id) => request.get({ entity: `lms/recordings/${id}/play` }),
  // Manual upload — fallback for the mock provider (no recorder of its own);
  // BigBlueButton records automatically. Lets the class teacher (or a
  // manager) attach a video file they recorded themselves.
  recordingUpload: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request.post({ entity: `lms/recordings/${id}/upload`, jsonData: fd });
  },
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
  myOverview: () => request.get({ entity: 'lms/my/overview' }),

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

  // ── assessments (ported from the python-test-platform reference project;
  // distinct from the generic quizzes/attempts calls above) ──────────
  startAssessment: (testType) => request.post({ entity: `lms/assessments/start/${testType}`, jsonData: {} }),
  submitAssessment: (attemptId, b) => request.post({ entity: `lms/assessments/${attemptId}/submit`, jsonData: b }),
  runAssessmentCode: (code) => request.post({ entity: 'lms/assessments/run-code', jsonData: { code } }),
  reportAssessmentProctorEvent: (attemptId, type) =>
    request.post({ entity: `lms/assessments/${attemptId}/proctor-event`, jsonData: { type } }),
  myAssessmentResults: () => request.get({ entity: 'lms/assessments/my-results' }),
  assessmentBreakdown: (attemptId) => request.get({ entity: `lms/assessments/${attemptId}/breakdown` }),
  adminAssessmentSummary: () => request.get({ entity: 'lms/assessments/admin/summary' }),
  adminAssessmentAttempts: (f = {}) => request.get({ entity: `lms/assessments/admin/attempts${qs(f)}` }),
  adminAssessmentReport: (attemptId) => request.get({ entity: `lms/assessments/admin/attempts/${attemptId}/report` }),
  assessmentCurriculumSessions: (f = {}) => request.get({ entity: `lms/assessments/admin/curriculum/sessions${qs(f)}` }),
  updateAssessmentDelivery: (sessionId, b) =>
    request.patch({ entity: `lms/assessments/admin/curriculum/sessions/${sessionId}/delivery`, jsonData: b }),

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
  myFees: (f = {}) => request.get({ entity: `lms/my/fees${qs(f)}` }),

  // ── policy & acknowledgement centre ──────────────────────────
  listPolicies: (f = {}) => request.get({ entity: `lms/policies${qs(f)}` }),
  createPolicy: (b) => request.post({ entity: 'lms/policies', jsonData: b }),
  getPolicy: (id) => request.get({ entity: `lms/policies/${id}` }),
  publishPolicy: (id) => request.post({ entity: `lms/policies/${id}/publish`, jsonData: {} }),
  archivePolicy: (id) => request.post({ entity: `lms/policies/${id}/archive`, jsonData: {} }),
  policyReport: (id) => request.get({ entity: `lms/policies/${id}/report` }),
  myPolicies: () => request.get({ entity: 'lms/my/policies' }),
  acknowledgePolicy: (id) => request.post({ entity: `lms/policies/${id}/acknowledge`, jsonData: {} }),

  // ── eligibility / placement readiness engine ─────────────────
  eligibilityRule: (courseId) => request.get({ entity: `lms/courses/${courseId}/eligibility-rule` }),
  saveEligibilityRule: (courseId, b) => request.post({ entity: `lms/courses/${courseId}/eligibility-rule`, jsonData: b }),
  eligibilityCourseReport: (courseId) => request.get({ entity: `lms/eligibility/course/${courseId}/report` }),
  myEligibility: () => request.get({ entity: 'lms/my/eligibility' }),

  // ── project management module ────────────────────────────────
  projects: (f = {}) => request.get({ entity: `lms/projects${qs(f)}` }),
  teacherProjects: (f = {}) => request.get({ entity: `lms/teacher/projects${qs(f)}` }),
  myProjects: () => request.get({ entity: 'lms/my/projects' }),
  getProject: (id) => request.get({ entity: `lms/projects/${id}` }),
  assignProject: (b) => request.post({ entity: 'lms/projects', jsonData: b }),
  updateProject: (id, b) => request.patch({ entity: `lms/projects/${id}`, jsonData: b }),
  updateMilestone: (id, b) => request.post({ entity: `lms/projects/${id}/milestones`, jsonData: b }),
  submitProject: (id, b) => request.post({ entity: `lms/projects/${id}/submit`, jsonData: b }),
  reviewProject: (id, b) => request.post({ entity: `lms/projects/${id}/review`, jsonData: b }),

  // ── camera/mic pre-join + attendance correction + system health ──
  joinPolicy: () => request.get({ entity: 'lms/live-settings/join-policy' }),
  deviceCheckLog: (id, b) => request.post({ entity: `lms/live-classes/${id}/device-check`, jsonData: b }),
  correctAttendance: (sessionId, b) => request.post({ entity: `lms/live-classes/${sessionId}/attendance/correct`, jsonData: b }),
  systemHealth: () => request.get({ entity: 'lms/admin/system-health' }),

  // ── learner 360 report ────────────────────────────────────────
  learner360: (courseId) => request.get({ entity: `lms/admin/learner-360/${courseId}` }),
  learner360Export: async (courseId, format = 'csv') => {
    let token = '';
    try { token = storePersist.get('auth')?.current?.token || ''; } catch (e) { /* noop */ }
    const res = await axios.get(`${API_BASE_URL}lms/admin/learner-360/${courseId}/export${qs({ format })}`, {
      responseType: 'blob',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `learner-360.${format}`;
    a.click();
    window.URL.revokeObjectURL(url);
  },
};

export default lmsApi;
