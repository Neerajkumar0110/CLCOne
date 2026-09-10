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
};

export default lmsApi;
