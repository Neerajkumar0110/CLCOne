import api from './api';
import storePersist from '@/redux/storePersist';

// Attendance ERP activity tracker — runs in every CRM / portal tab of a staff
// user. PRIVACY: it only notes THAT the mouse / keyboard / touch / scroll was
// used (a timestamp). It never reads which key, what was typed, the screen,
// or anything else. Every 30 s ONE heartbeat goes to the server for all open
// tabs together (localStorage election), so several tabs never double-count.
// The server decides Active / Inactive / Offline from server time.

const K = { kb: 'erp.t.kb', ms: 'erp.t.ms', beat: 'erp.t.beat' };
let started = false;
let hbSec = 30;
let idleSec = 300;
let lastLocalInput = Date.now();
const num = (k) => {
  try {
    return Number(localStorage.getItem(k)) || 0;
  } catch (e) {
    return 0;
  }
};
const put = (k, v) => {
  try {
    localStorage.setItem(k, String(v));
  } catch (e) {
    /* private mode — this tab still beats on its own */
  }
};

export function setTrackerConfig({ heartbeatSec, inactivitySec } = {}) {
  if (heartbeatSec) hbSec = Math.max(10, Number(heartbeatSec));
  if (inactivitySec) idleSec = Number(inactivitySec);
}

async function beat(force) {
  if (!storePersist.get('auth')?.current?.token) return;
  const now = Date.now();
  const prev = num(K.beat);
  if (!force && now - prev < hbSec * 1000 - 500) return; // another tab beat recently
  put(K.beat, now);
  const kb = num(K.kb);
  const ms = num(K.ms);
  const last = Math.max(kb, ms);
  const body = { kb: kb > prev, mouse: ms > prev, agoMs: last > prev ? now - last : 0 };
  const r = await api.post('me/heartbeat', body);
  if (r && r.success) window.dispatchEvent(new CustomEvent('erp:beat', { detail: r.result }));
  else if (!navigator.onLine) window.dispatchEvent(new CustomEvent('erp:beat', { detail: { offline: true } }));
}

export function startErpTracker() {
  if (started || typeof window === 'undefined') return;
  started = true;
  let lastWrite = 0;
  const mark = (key) => () => {
    const now = Date.now();
    const wasIdle = now - lastLocalInput >= Math.min(idleSec, 120) * 1000;
    lastLocalInput = now;
    if (now - lastWrite > 1000 || wasIdle) {
      lastWrite = now;
      put(key, now);
    }
    // first input after a long pause → tell the server at once, so
    // "back to Active" is stamped at the right minute
    if (wasIdle) beat(true);
  };
  const kb = mark(K.kb);
  const ms = mark(K.ms);
  // keydown: only the fact that a key went down — event.key is never read
  window.addEventListener('keydown', kb, { passive: true, capture: true });
  ['mousemove', 'mousedown', 'wheel', 'touchstart', 'scroll'].forEach((ev) => window.addEventListener(ev, ms, { passive: true, capture: true }));
  window.addEventListener('online', () => beat(true));
  setInterval(() => beat(false), 5000);
  setTimeout(() => beat(true), 1500);
}
