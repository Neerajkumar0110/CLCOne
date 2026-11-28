import axios from 'axios';
import { API_BASE_URL } from '@/config/serverApiConfig';
import storePersist from '@/redux/storePersist';
import errorHandler from '@/request/errorHandler';

// Attendance ERP API (/api/attendance-erp/*). Same login token as the CRM.
const token = () => storePersist.get('auth')?.current?.token;
const http = () => axios.create({ baseURL: `${API_BASE_URL}attendance-erp/`, headers: { Authorization: `Bearer ${token()}` } });

async function wrap(p, { quiet = true } = {}) {
  try {
    const r = await p;
    return r.data;
  } catch (e) {
    const d = e?.response?.data;
    // expired / replaced session → the app's normal logout flow
    if (e?.response?.status === 401 && d?.jwtExpired) return errorHandler(e);
    if (!quiet) errorHandler(e);
    return { success: false, result: null, status: e?.response?.status || 0, message: d?.message || e.message || 'Something went wrong' };
  }
}

const clean = (params) => Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'All'));

const api = {
  get: (url, params) => wrap(http().get(url, { params: clean(params) })),
  post: (url, body) => wrap(http().post(url, body || {})),
  put: (url, body) => wrap(http().put(url, body || {})),
  upload: (url, form) => wrap(http().post(url, form, { headers: { 'Content-Type': 'multipart/form-data' } })),
  // file downloads (export, attachments) need the token, so fetch as a blob
  async download(url, params, filename) {
    try {
      const r = await http().get(url, { params: clean(params), responseType: 'blob' });
      const href = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 4000);
      return true;
    } catch (e) {
      return false;
    }
  },
  async openFile(url) {
    try {
      const r = await http().get(url, { responseType: 'blob' });
      window.open(URL.createObjectURL(r.data), '_blank', 'noopener');
      return true;
    } catch (e) {
      return false;
    }
  },
};

export const agentApi = {
  register: (body) => wrap(axios.post(`${API_BASE_URL}erp-agent/register`, body, { headers: { Authorization: `Bearer ${token()}` } })),
};

export default api;
