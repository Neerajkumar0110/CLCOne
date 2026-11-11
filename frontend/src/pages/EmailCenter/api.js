import axios from 'axios';
import { API_BASE_URL } from '@/config/serverApiConfig';
import storePersist from '@/redux/storePersist';

// /api/email-center/* — Messenger › Email (admin only). Errors come back as
// { success:false, message } so the screen shows the backend's own words.
const http = () => {
  const token = storePersist.get('auth')?.current?.token;
  return axios.create({ baseURL: API_BASE_URL + 'email-center/', withCredentials: true, headers: token ? { Authorization: `Bearer ${token}` } : {} });
};

async function wrap(p) {
  try {
    return (await p).data;
  } catch (err) {
    return { success: false, status: err.response?.status, message: err.response?.data?.message || err.message || 'Something went wrong.' };
  }
}

const k = (key) => `item/${encodeURIComponent(key)}`;
const emailApi = {
  list: () => wrap(http().get('')),
  item: (key) => wrap(http().get(k(key))),
  save: (key, body) => wrap(http().put(k(key), body)),
  reset: (key) => wrap(http().post(`${k(key)}/reset`, {})),
  test: (key, body = {}) => wrap(http().post(`${k(key)}/test`, body)),
  remove: (key) => wrap(http().delete(k(key))),
  create: (body) => wrap(http().post('custom', body)),
};

// same rule as the server (services/mail/emailTemplates.js#render): a
// variable ending in "Html" is inserted as HTML, everything else as text
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const renderTemplate = (text, vars = {}) =>
  String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) => (vars[key] == null ? '' : /Html$/.test(key) ? String(vars[key]) : esc(vars[key])));

export default emailApi;
