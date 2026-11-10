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
  liveClassesRange: (from, to) => request.get({ entity: `lms/live-classes${qs({ scope: 'all', from, to, topics: 1 })}` }),
  liveClass: (id) => request.get({ entity: `lms/live-classes/${id}` }),
  // teacher / manager: set or edit a class's scheduled start + duration
  // ({ scheduledStart, scheduledDurationMin, autoStartAt, title }).
  liveClassUpdate: (id, patch) => request.patch({ entity: `lms/live-classes/${id}`, jsonData: patch }),
  // teacher / support / manager: push a class (and every later not-yet-started
  // class in its recurring series) forward by N days — class is running late.
  liveClassPostpone: (id, days) => request.post({ entity: `lms/live-classes/${id}/postpone`, jsonData: { days } }),
  // manager / Support: delete one not-yet-started class; switch a batch's
  // daily classes off / on, and list the batches that are off.
  liveClassDelete: (id) => request.post({ entity: `lms/live-classes/${id}/delete`, jsonData: {} }),
  batchClassesPause: (batchId) => request.post({ entity: `lms/batches/${batchId}/live-pause`, jsonData: {} }),
  batchClassesResume: (batchId) => request.post({ entity: `lms/batches/${batchId}/live-resume`, jsonData: {} }),
  pausedBatches: () => request.get({ entity: 'lms/batches/live-paused' }),
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
  // Organisation-wide holiday calendar (no classes on these days).
  holidays: (year) => request.get({ entity: `lms/admin/holidays${qs({ year })}` }),
  // Read-only, any signed-in role — used by the Calendar to mark holidays.
  holidaysPublic: (year) => request.get({ entity: `lms/holidays${qs({ year })}` }),
  // Every batch + how far through its course it is (manager only).
  curriculumOverview: () => request.get({ entity: 'lms/admin/curriculum/overview' }),
  holidaySetYear: (key, body) => request.post({ entity: `lms/admin/holidays/${key}`, jsonData: body }),
  // Mark a class as orientation / doubt / revision so the curriculum
  // mapping skips it (and its recording keeps its own name).
  liveClassSyllabusFlag: (id, countsTowardSyllabus) =>
    request.post({ entity: `lms/live-classes/${id}/syllabus`, jsonData: { countsTowardSyllabus } }),
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
  recordingImportDrive: (id) => request.post({ entity: `lms/admin/recordings/${id}/import-drive`, jsonData: {} }),
  // Paste-a-link backfill (Google Drive, etc.) — sessionId is the class's own
  // id, not the recording row's (there may not be one yet).
  recordingAttachLink: (sessionId, url) =>
    request.post({ entity: `lms/live-classes/${sessionId}/recording-link`, jsonData: { url } }),
  // links: [{ date: 'YYYY-MM-DD', url }]
  batchBulkAttachRecordingLinks: (batchId, links) =>
    request.post({ entity: `lms/admin/batches/${batchId}/recording-links`, jsonData: { links } }),
  // Import a whole Drive folder of class videos into a batch (Recordings →
  // "Import from Drive").
  driveStatus: () => request.get({ entity: 'lms/admin/drive/status' }),
  driveConnect: () => request.get({ entity: 'lms/admin/drive/connect' }),
  driveDisconnect: () => request.post({ entity: 'lms/admin/drive/disconnect', jsonData: {} }),
  driveScan: (batchId, folderUrl) => request.post({ entity: 'lms/admin/drive/scan', jsonData: { batchId, folderUrl } }),
  driveImport: (batchId, items) => request.post({ entity: 'lms/admin/drive/import', jsonData: { batchId, items } }),
  driveProgress: (batchId) => request.get({ entity: `lms/admin/drive/progress${qs({ batchId })}` }),

  // ── attendance ────────────────────────────────────────────────────
  adminAttendance: (f = {}) => request.get({ entity: `lms/admin/attendance${qs(f)}` }),
  teacherAttendance: (f = {}) => request.get({ entity: `lms/teacher/attendance${qs(f)}` }),
  studentAttendance: (f = {}) => request.get({ entity: `lms/student/attendance${qs(f)}` }),
  // one candidate's full attendance report (row click on the dashboard)
  attendanceStudentReport: (role, f = {}) => request.get({ entity: `lms/${role}/attendance/student${qs(f)}` }),
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
  teacherStudents: (f = {}) => request.get({ entity: `lms/teacher/students${qs(f)}` }),
  studentDashboard: (f = {}) => request.get({ entity: `lms/student/dashboard${qs(f)}` }),
  myOverview: () => request.get({ entity: 'lms/my/overview' }),

  // ── curriculum builder (teacher) ─────────────────────────────────
  courseOutline: (courseId, batch) => request.get({ entity: `lms/courses/${courseId}/outline${qs({ batch })}` }),
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
  // Fire-and-forget: why a learner couldn't open a test (proctoring setup or
  // a refused start) — kept in the LMS audit log for support.
  reportAssessmentGateIssue: (b) =>
    request.post({ entity: 'lms/assessments/gate-issue', jsonData: { ...b, device: navigator.userAgent } }).catch(() => {}),
  submitAssessment: (attemptId, b) => request.post({ entity: `lms/assessments/${attemptId}/submit`, jsonData: b }),
  runAssessmentCode: (code) => request.post({ entity: 'lms/assessments/run-code', jsonData: { code } }),
  reportAssessmentProctorEvent: (attemptId, type) =>
    request.post({ entity: `lms/assessments/${attemptId}/proctor-event`, jsonData: { type } }),
  myAssessmentResults: () => request.get({ entity: 'lms/assessments/my-results' }),
  assessmentBatchProgress: (batch) => request.get({ entity: `lms/assessments/batch-progress${qs({ batch })}` }),
  assessmentBreakdown: (attemptId) => request.get({ entity: `lms/assessments/${attemptId}/breakdown` }),
  adminAssessmentSummary: () => request.get({ entity: 'lms/assessments/admin/summary' }),
  adminAssessmentAttempts: (f = {}) => request.get({ entity: `lms/assessments/admin/attempts${qs(f)}` }),
  adminAssessmentReport: (attemptId) => request.get({ entity: `lms/assessments/admin/attempts/${attemptId}/report` }),
  assessmentCurriculumSessions: (f = {}) => request.get({ entity: `lms/assessments/admin/curriculum/sessions${qs(f)}` }),
  updateAssessmentDelivery: (sessionId, b) =>
    request.patch({ entity: `lms/assessments/admin/curriculum/sessions/${sessionId}/delivery`, jsonData: b }),
  // Manual curriculum-gate bypass — open a test for a batch/learner ahead
  // of its tracked delivery % crossing the threshold.
  listUnlockOverrides: (f = {}) => request.get({ entity: `lms/assessments/admin/unlock-overrides${qs(f)}` }),
  grantUnlockOverride: (b) => request.post({ entity: 'lms/assessments/admin/unlock-overrides', jsonData: b }),
  revokeUnlockOverride: (id) => request.del({ entity: `lms/assessments/admin/unlock-overrides/${id}` }),

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

  // ── study material ───────────────────────────────────────────────
  materials: () => request.get({ entity: 'lms/materials' }),
  myMaterials: () => request.get({ entity: 'lms/my/materials' }),
  deleteMaterial: (id) => request.del({ entity: `lms/materials/${id}` }),
  studentsUnassignedCount: () => request.get({ entity: 'lms/students/unassigned-count' }),
  addMaterialLink: (b) => request.post({ entity: 'lms/materials/link', jsonData: b }),
  // Raw axios (not request.post) so we can report real upload % via
  // onUploadProgress — axios.defaults already carries the auth token/baseURL
  // set by any earlier request.* call this session (see request/request.js).
  uploadMaterial: (fields, file, onProgress) => {
    const fd = new FormData();
    Object.entries(fields || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') fd.append(k, v);
    });
    fd.append('file', file);
    return axios
      .post(`${API_BASE_URL}lms/materials`, fd, {
        onUploadProgress: (e) => onProgress && onProgress(Math.round((e.loaded * 100) / (e.total || 1))),
      })
      .then((r) => r.data)
      .catch((e) => (e.response ? e.response.data : { success: false, message: 'Upload failed.' }));
  },

  // ── certificates ──────────────────────────────────────────────
  certRule: (courseId) => request.get({ entity: `lms/courses/${courseId}/certificate-rule` }),
  saveCertRule: (courseId, b) => request.post({ entity: `lms/courses/${courseId}/certificate-rule`, jsonData: b }),
  issueCertificate: (b) => request.post({ entity: 'lms/certificates/issue', jsonData: b }),
  runCertificates: (courseId) => request.post({ entity: `lms/certificates/run/${courseId}`, jsonData: {} }),
  certHistory: (f = {}) => request.get({ entity: `lms/certificates${qs(f)}` }),
  myCertificates: () => request.get({ entity: 'lms/my/certificates' }),
  myExternalCertificates: () => request.get({ entity: 'lms/my/external-certificates' }),
  addExternalCertificate: (b) => request.post({ entity: 'lms/my/external-certificates', jsonData: b }),
  removeExternalCertificate: (id) => request.del({ entity: `lms/my/external-certificates/${id}` }),
  externalCertificateFile: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request.post({ entity: 'lms/my/external-certificates/file', jsonData: fd });
  },
  adminExternalCertificates: (status) => request.get({ entity: `lms/admin/external-certificates${status ? `?status=${status}` : ''}` }),
  reviewExternalCertificate: (id, decision, note) => request.post({ entity: `lms/admin/external-certificates/${id}/review`, jsonData: { decision, note } }),
  certificateRoster: () => request.get({ entity: 'lms/certificates/roster' }),
  verifyCertificate: (cid) => request.get({ entity: `lms/certificates/verify/${cid}` }),
  // PDF download -> fetch with the bearer (binary, so it can't go through a
  // plain <a href>), then trigger a client download. Same pattern as
  // attendanceExport/learner360Export above.
  // Enrollment receipt with the current payment plan (same PDF the welcome email attaches).
  downloadFeeReceipt: async (filename) => {
    let token = '';
    try { token = storePersist.get('auth')?.current?.token || ''; } catch (e) { /* noop */ }
    const res = await axios.get(`${API_BASE_URL}lms/my/fees/receipt`, {
      responseType: 'blob',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename || 'receipt'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
  downloadCertificatePdf: async (id, mine, filename) => {
    let token = '';
    try { token = storePersist.get('auth')?.current?.token || ''; } catch (e) { /* noop */ }
    const base = mine ? 'lms/my/certificates' : 'lms/certificates';
    const res = await axios.get(`${API_BASE_URL}${base}/${id}/download`, {
      responseType: 'blob',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename || 'certificate'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
  // View-only — opens inline in a new tab (browser's own PDF viewer),
  // never a forced save, so a candidate can see what their certificate
  // will look like before it's actually unlocked. Revokes the blob URL
  // after a minute, giving the new tab time to finish loading it.
  previewCertificatePdf: async (courseId) => {
    let token = '';
    try { token = storePersist.get('auth')?.current?.token || ''; } catch (e) { /* noop */ }
    const res = await axios.get(`${API_BASE_URL}lms/my/certificates/preview?course=${courseId}`, {
      responseType: 'blob',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => window.URL.revokeObjectURL(url), 60000);
  },

  // ── analytics ─────────────────────────────────────────────────
  teacherAnalytics: (f = {}) => request.get({ entity: `lms/teacher/analytics${qs(f)}` }),
  teacherLiveAnalytics: (f = {}) => request.get({ entity: `lms/teacher/live-analytics${qs(f)}` }),

  // ── panel real-time poll ─────────────────────────────────────
  updates: () => request.get({ entity: 'lms/my/updates' }),
  requestReactivation: (note) => request.post({ entity: 'lms/my/reactivation-request', jsonData: { note } }),
  setCandidateAccess: (id, active, reason) => request.post({ entity: `lms/students/${id}/access`, jsonData: { active, reason } }),
  myFees: (f = {}) => request.get({ entity: `lms/my/fees${qs(f)}` }),
  // Help & Support tickets (backend lmsController/supportTickets.js)
  myTickets: () => request.get({ entity: 'lms/my/tickets' }),
  myTicketPayments: () => request.get({ entity: 'lms/my/tickets/payments' }),
  createTicket: (b) => request.post({ entity: 'lms/my/tickets', jsonData: b }),
  confirmTicket: (id, resolved, note) => request.post({ entity: `lms/my/tickets/${id}/confirm`, jsonData: { resolved, note } }),
  ticketAttachment: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request.post({ entity: 'lms/my/tickets/attachment', jsonData: fd });
  },

  // ── policy & acknowledgement centre ──────────────────────────
  listPolicies: (f = {}) => request.get({ entity: `lms/policies${qs(f)}` }),
  createPolicy: (b) => request.post({ entity: 'lms/policies', jsonData: b }),
  getPolicy: (id) => request.get({ entity: `lms/policies/${id}` }),
  publishPolicy: (id) => request.post({ entity: `lms/policies/${id}/publish`, jsonData: {} }),
  archivePolicy: (id) => request.post({ entity: `lms/policies/${id}/archive`, jsonData: {} }),
  policyReport: (id) => request.get({ entity: `lms/policies/${id}/report` }),
  myPolicies: () => request.get({ entity: 'lms/my/policies' }),
  acknowledgePolicy: (id) => request.post({ entity: `lms/policies/${id}/acknowledge`, jsonData: {} }),
  myOnboarding: () => request.get({ entity: 'lms/my/onboarding' }),
  markOnboarding: (step, b) => request.post({ entity: `lms/my/onboarding/${step}`, jsonData: b || {} }),
  myFeedback: () => request.get({ entity: 'lms/my/feedback' }),
  submitFeedback: (b) => request.post({ entity: 'lms/my/feedback', jsonData: b }),
  feedbackMySummary: () => request.get({ entity: 'lms/feedback/my-summary' }),
  feedbackActions: () => request.get({ entity: 'lms/feedback/actions' }),
  createFeedbackAction: (b) => request.post({ entity: 'lms/feedback/actions', jsonData: b }),
  updateFeedbackAction: (id, b) => request.patch({ entity: `lms/feedback/actions/${id}`, jsonData: b }),
  feedbackAdminOverview: (weeks) => request.get({ entity: `lms/feedback/admin/overview${qs({ weeks })}` }),
  feedbackAdminRemind: (batch) => request.post({ entity: 'lms/feedback/admin/remind', jsonData: { batch } }),
  markPolicyOpened: (id) => request.post({ entity: `lms/my/policies/${id}/open`, jsonData: {} }),
  deletePolicy: (id) => request.del({ entity: `lms/policies/${id}` }),

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
  uploadProjectFile: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request.post({ entity: `lms/projects/${id}/files`, jsonData: fd });
  },
  setProjectBlocker: (id, text) => request.post({ entity: `lms/projects/${id}/blocker`, jsonData: { text } }),
  reviewProject: (id, b) => request.post({ entity: `lms/projects/${id}/review`, jsonData: b }),
  deleteProject: (id) => request.del({ entity: `lms/projects/${id}` }),

  // ── camera/mic pre-join + attendance correction + system health ──
  joinPolicy: () => request.get({ entity: 'lms/live-settings/join-policy' }),
  deviceCheckLog: (id, b) => request.post({ entity: `lms/live-classes/${id}/device-check`, jsonData: b }),
  liveMyNote: (id) => request.get({ entity: `lms/live-classes/${id}/my-note` }),
  saveLiveMyNote: (id, text) => request.post({ entity: `lms/live-classes/${id}/my-note`, jsonData: { text } }),
  liveChat: (id, after) => request.get({ entity: `lms/live-classes/${id}/chat${after ? `?after=${encodeURIComponent(after)}` : ''}` }),
  sendLiveChat: (id, text) => request.post({ entity: `lms/live-classes/${id}/chat`, jsonData: { text } }),
  removeLiveChat: (id, msgId) => request.del({ entity: `lms/live-classes/${id}/chat/${msgId}` }),
  correctAttendance: (sessionId, b) => request.post({ entity: `lms/live-classes/${sessionId}/attendance/correct`, jsonData: b }),
  systemHealth: () => request.get({ entity: 'lms/admin/system-health' }),
  toggleIncidentMode: (active, message) => request.post({ entity: 'lms/admin/incident-mode', jsonData: { active, message } }),
  // ── LMS → Admin & Ops (design page 6, A1–A11) ────────────────
  opsApprovals: () => request.get({ entity: 'lms/admin/ops/approvals' }),
  opsApprovalCreate: (b) => request.post({ entity: 'lms/admin/ops/approvals', jsonData: b }),
  opsApprovalDecide: (id, decision, reason) => request.post({ entity: `lms/admin/ops/approvals/${id}/decide`, jsonData: { decision, reason } }),
  opsDecisionSet: (code, status, note) => request.post({ entity: `lms/admin/ops/decisions/${code}`, jsonData: { status, note } }),
  opsKpis: (month) => request.get({ entity: `lms/admin/ops/kpis${qs({ month })}` }),
  opsPayments: (q) => request.get({ entity: `lms/admin/ops/payments${qs({ q })}` }),
  opsPaymentDetail: (id) => request.get({ entity: `lms/admin/ops/payments/${id}` }),
  opsPaymentRecheck: (id) => request.post({ entity: `lms/admin/ops/payments/${id}/recheck`, jsonData: {} }),
  opsPaymentProvision: (id, b) => request.post({ entity: `lms/admin/ops/payments/${id}/provision`, jsonData: b }),
  opsRoles: (role) => request.get({ entity: `lms/admin/ops/roles${qs({ role })}` }),
  opsRoleDraft: (role, matrix) => request.post({ entity: `lms/admin/ops/roles/${encodeURIComponent(role)}/draft`, jsonData: { matrix } }),
  opsRoleApprove: (role) => request.post({ entity: `lms/admin/ops/roles/${encodeURIComponent(role)}/approve`, jsonData: {} }),
  opsPolicies: (id) => request.get({ entity: `lms/admin/ops/policies${qs({ id })}` }),
  opsPolicySendForApproval: (id, b) => request.post({ entity: `lms/admin/ops/policies/${id}/send-for-approval`, jsonData: b }),
  opsHealth: () => request.get({ entity: 'lms/admin/ops/health' }),
  opsReports: () => request.get({ entity: 'lms/admin/ops/reports' }),
  opsAutomation: () => request.get({ entity: 'lms/admin/ops/automation' }),
  opsAutomationToggle: (key, running) => request.post({ entity: `lms/admin/ops/automation/${key}`, jsonData: { running } }),
  opsSecurity: (f = {}) => request.get({ entity: `lms/admin/ops/security${qs(f)}` }),
  opsEvidence: (type) => request.get({ entity: `lms/admin/ops/evidence${qs({ type })}` }),
  opsRules: () => request.get({ entity: 'lms/admin/ops/rules' }),
  opsRulesPropose: (values) => request.post({ entity: 'lms/admin/ops/rules/proposal', jsonData: { values } }),
  opsRulesApprove: () => request.post({ entity: 'lms/admin/ops/rules/approve', jsonData: {} }),
  opsRulesDiscard: () => request.post({ entity: 'lms/admin/ops/rules/discard', jsonData: {} }),
  // file downloads (reports, KPI export) — same blob pattern as the receipt
  opsDownload: async (path, params, filename) => {
    let token = '';
    try { token = storePersist.get('auth')?.current?.token || ''; } catch (e) { /* noop */ }
    // '/lms/…' = any LMS path; otherwise relative to lms/admin/ops/
    const rel = path.startsWith('/') ? path.slice(1) : `lms/admin/ops/${path}`;
    const res = await axios.get(`${API_BASE_URL}${rel}${qs(params)}`, {
      responseType: 'blob',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  // ── Project Manager boards (design P1–P10) ───────────────────
  pmRecording: (id, enabled) => request.post({ entity: `lms/live-classes/${id}/recording`, jsonData: { enabled } }),
  pmClass: (id) => request.get({ entity: `lms/teacher/pm/class/${id}` }),
  pmSaveDelivery: (b) => request.post({ entity: 'lms/teacher/pm/delivery', jsonData: b }),
  pmCurriculum: (f = {}) => request.get({ entity: `lms/teacher/pm/curriculum${qs(f)}` }),
  pmLinkCheck: (projectId) => request.get({ entity: `lms/teacher/pm/projects/${projectId}/link-check` }),
  pmAssess: (f = {}) => request.get({ entity: `lms/teacher/pm/assess${qs(f)}` }),
  pmAssessVerify: (b) => request.post({ entity: 'lms/teacher/pm/assess/verify', jsonData: b }),
  pmLearner: (email) => request.get({ entity: `lms/teacher/pm/learner${qs({ email })}` }),
  pmLearnerNote: (email, text) => request.post({ entity: 'lms/teacher/pm/learner/notes', jsonData: { email, text } }),
  pmAttendanceReview: (email, note) => request.post({ entity: 'lms/teacher/pm/learner/attendance-review', jsonData: { email, note } }),
  pmExtensions: () => request.get({ entity: 'lms/teacher/pm/extensions' }),
  pmExtensionSend: (id) => request.post({ entity: `lms/teacher/pm/extensions/${id}/send`, jsonData: {} }),
  pmAnnounce: (b) => request.post({ entity: 'lms/teacher/pm/announce', jsonData: b }),
  pmCandidates: (f = {}) => request.get({ entity: `lms/teacher/pm/candidates${qs(f)}` }),

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
