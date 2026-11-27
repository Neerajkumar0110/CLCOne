import axios from 'axios';
import { API_BASE_URL } from '@/config/serverApiConfig';
import storePersist from '@/redux/storePersist';

// API for the LMS Additional Requirements screens (/api/lms/growth/*,
// public /api/lms-public/*). Returns the server's { success, result,
// message } body; network / HTTP errors come back as { success:false }.
const auth = () => {
  const token = storePersist.get('auth')?.current?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};
const G = `${API_BASE_URL}lms/growth/`;
const P = `${API_BASE_URL}lms-public/`;

async function call(method, url, data, opts = {}) {
  try {
    const r = await axios({ method, url, data, headers: { ...auth(), ...(opts.headers || {}) }, withCredentials: true, ...opts.extra });
    return r.data;
  } catch (e) {
    const d = e && e.response && e.response.data;
    return { success: false, message: (d && d.message) || e.message || 'Request failed', status: e.response && e.response.status };
  }
}

const q = (o = {}) => {
  const s = Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return s ? `?${s}` : '';
};

async function download(url, fallbackName) {
  const r = await axios.get(url, { responseType: 'blob', headers: auth(), withCredentials: true });
  const name = (/filename="([^"]+)"/.exec(r.headers['content-disposition'] || '') || [])[1] || fallbackName;
  const href = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}

const api = {
  q,
  get: (path, params) => call('get', `${G}${path}${q(params)}`),
  post: (path, body) => call('post', `${G}${path}`, body || {}),
  put: (path, body) => call('put', `${G}${path}`, body || {}),
  del: (path) => call('delete', `${G}${path}`),
  upload: (path, file, field = 'file', extra = {}) => {
    const fd = new FormData();
    fd.append(field, file);
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    return call('post', `${G}${path}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  download: (path, name) => download(`${G}${path}`, name),
  pub: (path) => call('get', `${P}${path}`),

  // 1 · Learner 360°
  report: (id = 'me') => api.get(`360/${id}`),
  pdf: (id = 'me', name = '360-report.pdf') => download(`${G}360/${id}/pdf`, name),
  saveProfile: (body) => api.put('profile/me', body),
  uploadResume: (file) => api.upload('profile/me/resume', file),
  uploadPhoto: (file) => api.upload('profile/me/photo', file),
  mentorLearners: (batch) => api.get('mentor/learners', { batch }),
  remarks: (id) => api.get(`remarks/${id}`),
  addRemark: (id, body) => api.post(`remarks/${id}`, body),
  deleteRemark: (rid) => api.del(`remarks/item/${rid}`),
  config: () => api.get('config'),
  saveConfig: (body) => api.put('config', body),
  leaderboard: (batch, recalc) => api.get('leaderboard', { batch, recalc: recalc ? 1 : undefined }),
  share: () => api.get('share/me'),
  saveShare: (body) => api.put('share/me', body),
  revokeShare: () => api.del('share/me'),
  // 2 · Projects
  projectMeta: () => api.get('projects/meta'),
  briefs: () => api.get('projects/briefs'),
  brief: (id) => api.get(`projects/briefs/${id}`),
  saveBrief: (id, body) => (id ? api.put(`projects/briefs/${id}`, body) : api.post('projects/briefs', body)),
  archiveBrief: (id) => api.del(`projects/briefs/${id}`),
  uploadProjectFile: (file) => api.upload('projects/upload', file),
  // upload + read title / description / requirements out of a .docx / .txt / .md
  extractProjectFile: (file) => api.upload('projects/upload', file, 'file', { extract: '1' }),
  candidates: (briefId, batch) => api.get(`projects/allocate/${briefId}/candidates`, { batch }),
  allocate: (briefId, body) => api.post(`projects/allocate/${briefId}`, body),
  projectDashboard: (f) => api.get('projects/dashboard', f),
  projectDesk: () => api.get('projects/desk'),
  projectAutomation: () => api.get('projects/automation'),
  myProjects: () => api.get('projects/my'),
  alloc: (id) => api.get(`projects/alloc/${id}`),
  saveDraft: (id, body) => api.put(`projects/my/${id}/draft`, body),
  submitProject: (id, body) => api.post(`projects/my/${id}/submit`, body),
  askExtension: (id, body) => api.post(`projects/my/${id}/extension`, body),
  decideExtension: (id, body) => api.post(`projects/alloc/${id}/extension`, body),
  review: (id, body) => api.post(`projects/alloc/${id}/review`, body),
  override: (id, body) => api.post(`projects/alloc/${id}/override`, body),
  resubmit: (id, body) => api.post(`projects/alloc/${id}/resubmit`, body),
  reallocate: (id, body) => api.post(`projects/alloc/${id}/reallocate`, body),
  remind: (id) => api.post(`projects/alloc/${id}/remind`),
  nudge: (id) => api.post(`projects/alloc/${id}/nudge`),
  notifyDecision: (id) => api.post(`projects/alloc/${id}/notify-decision`),
  reallocRequest: (id, note) => api.post(`projects/alloc/${id}/realloc-request`, { note }),

  // 3 · Engagement
  activityConfig: () => api.get('activity/config'),
  beat: (body) => api.post('activity/beat', body),
  contentProgress: (body) => api.post('content/progress', body),
  practice: (range) => api.get('practice/me', { range }),
  savePractice: (body) => api.put('practice/me', body),
  contentMe: (module) => api.get('content/me', { module }),
  mentorEngagement: (batch) => api.get('engagement/mentor', { batch }),
  nudgeAlert: (id, text) => api.post(`engagement/alerts/${id}/nudge`, { text }),
  alertToSupport: (id) => api.post(`engagement/alerts/${id}/to-support`),
  resolveAlert: (id) => api.post(`engagement/alerts/${id}/resolve`),
  messageLearner: (learnerId, text) => api.post(`engagement/learner/${learnerId}/message`, { text }),
  outreach: (tab) => api.get('engagement/outreach', { tab }),
  outreachLearner: (id) => api.get(`engagement/outreach/${id}/learner`),
  saveOutreach: (id, body) => api.post(`engagement/outreach/${id}`, body),
  dropRisk: (id) => api.post(`engagement/outreach/${id}/drop-risk`),
  outreachEmail: (id, text) => api.post(`engagement/outreach/${id}/email`, { text }),

  // 4 · QA
  myFlags: () => api.get('flags/me'),
  qaOverview: () => api.get('qa/overview'),
  qaCreateRelease: (body) => api.post('qa/releases', body),
  qaRelease: (id, action, body) => api.post(`qa/releases/${id}/${action}`, body),
  qaSaveSettings: (body) => api.put('qa/settings', body),
  qaAccounts: () => api.get('qa/accounts'),
  qaAddAccount: (body) => api.post('qa/accounts', body),
  qaReset: (sets) => api.post('qa/reset', { sets }),
  qaRuns: () => api.get('qa/runs'),
  qaStartRun: (release) => api.post('qa/runs', { release }),
  qaSaveCase: (id, body) => (id ? api.put(`qa/cases/${id}`, body) : api.post('qa/cases', body)),
  qaBugs: (release) => api.get('qa/bugs', { release }),
  qaSaveBug: (id, body) => (id ? api.put(`qa/bugs/${id}`, body) : api.post('qa/bugs', body)),
  qaFlags: () => api.get('qa/flags'),
  qaSaveFlag: (id, body) => (id ? api.put(`qa/flags/${id}`, body) : api.post('qa/flags', body)),
  qaLogs: (q) => api.get('qa/logs', q),

  publicProfile: (token) => api.pub(`profile/${token}`),
  verify360: (code) => api.pub(`verify-360/${code}`),
};

export default api;
