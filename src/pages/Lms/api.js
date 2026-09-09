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
};

export default lmsApi;
