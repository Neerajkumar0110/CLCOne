import { useEffect, useRef } from 'react';
import api from './api';

// Practice & engagement tracker (Figma 3A / 3B / 3E) — runs inside the
// learner panel. Only ACTIVE time counts: a second is active when the tab is
// visible and the learner typed / clicked / scrolled / moved within the idle
// timeout (admin setting, default 3 min), or a video is playing. Everything
// else is idle and reported separately (never added to active time).
// A heartbeat goes to the server every 30 s.

let started = false;
let ctx = null; // what the learner is on right now { kind, ref, title, course, module, topic }

export function setActivityContext(c) {
  ctx = c ? { ...c } : null;
}

// route → kind when a page didn't set a context
function kindFromPath(p) {
  if (/\/learn\/(recordings)/.test(p)) return 'video';
  if (/\/learn\/(material|curriculum|courses|learning)/.test(p)) return 'lesson';
  if (/\/learn\/(tests|quizzes|assessment|test)/.test(p)) return 'assessment';
  if (/\/learn\/classes|\/live\//.test(p)) return 'live';
  if (/code-editor/.test(p)) return 'editor';
  return 'other';
}

export function startActivityTracker() {
  if (started || typeof window === 'undefined') return;
  started = true;
  let idleMs = 3 * 60 * 1000;
  let countHidden = false;
  let enabled = true;
  let last = Date.now();
  let activeSec = 0;
  let idleSec = 0;
  let first = true;
  const mark = () => {
    last = Date.now();
  };
  ['keydown', 'mousedown', 'mousemove', 'wheel', 'scroll', 'touchstart', 'pointerdown'].forEach((e) => window.addEventListener(e, mark, { passive: true, capture: true }));
  api.activityConfig().then((r) => {
    if (r && r.success && r.result) {
      idleMs = (r.result.idleTimeoutMin || 3) * 60 * 1000;
      countHidden = !!(r.result.active && r.result.active.hiddenTab);
      enabled = r.result.track !== false;
    }
  });
  const videoPlaying = () => Array.from(document.querySelectorAll('video')).some((v) => !v.paused && !v.ended && v.readyState > 2);
  // the code editor runs in an iframe — focus inside it counts as typing
  const editorFocused = () => document.activeElement && document.activeElement.tagName === 'IFRAME' && /code-editor|vscode/i.test(document.activeElement.src || '');
  setInterval(() => {
    const visible = document.visibilityState === 'visible';
    const active = (visible || countHidden) && (Date.now() - last < idleMs || videoPlaying() || editorFocused());
    if (active) activeSec += 1;
    else if (visible || activeSec || idleSec) idleSec += 1;
  }, 1000);
  const flush = () => {
    if (!enabled || (!activeSec && !idleSec)) return;
    const c = ctx || { kind: kindFromPath(window.location.pathname) };
    const body = { activeSec, idleSec, kind: c.kind, ref: c.ref, title: c.title, course: c.course, module: c.module, topic: c.topic, first };
    activeSec = 0;
    idleSec = 0;
    first = false;
    api.beat(body);
  };
  setInterval(flush, 30000);
  window.addEventListener('pagehide', flush);
}

// Content progress for one item (3B): reading scroll depth + time on page, or
// video watch buckets / pauses / rewatches. Pass the scroll container (or
// none = the page) and/or a <video> element ref.
// readSecTarget: for content whose scrolling we cannot see (an embedded PDF),
// reading depth grows with active time instead (target seconds = 100%).
export function useContentProgress({ kind, ref, title, course, module, scrollRef, videoRef, readSecTarget, enabled = true }) {
  const st = useRef(null);
  useEffect(() => {
    if (!enabled || !ref || !kind) return undefined;
    setActivityContext({ kind: kind === 'recording' ? 'video' : kind === 'material' ? 'material' : kind, ref, title, course, module });
    const s = { depth: 0, total: 0, sec: 0, watched: new Set(), pauses: 0, rewatches: 0, dur: 0, lastT: 0, last: Date.now(), sent: false };
    st.current = s;
    const mark = () => {
      s.last = Date.now();
    };
    window.addEventListener('keydown', mark, true);
    window.addEventListener('mousemove', mark, true);
    window.addEventListener('wheel', mark, true);
    window.addEventListener('touchstart', mark, true);
    const scrollEl = () => (scrollRef && scrollRef.current) || document.scrollingElement || document.documentElement;
    const onScroll = () => {
      if (readSecTarget) return;
      const el = scrollEl();
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      const d = max <= 4 ? 100 : Math.round(((el.scrollTop + 0) / max) * 100);
      s.depth = Math.max(s.depth, Math.min(100, d));
      mark();
    };
    const sc = scrollRef && scrollRef.current ? scrollRef.current : window;
    sc.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(onScroll, 1500); // a short page that needs no scrolling counts as fully seen
    const tick = setInterval(() => {
      const v = videoRef && videoRef.current;
      const playing = v && v.tagName === 'VIDEO' && !v.paused && !v.ended;
      if (document.visibilityState === 'visible' && (Date.now() - s.last < 3 * 60 * 1000 || playing)) {
        s.sec += 1;
        s.total += 1;
        if (readSecTarget) s.depth = Math.max(s.depth, Math.min(100, Math.round((s.total / readSecTarget) * 100)));
      }
    }, 1000);
    // video
    let v = null;
    const onTime = () => {
      if (!v) return;
      s.dur = v.duration && Number.isFinite(v.duration) ? v.duration : s.dur;
      const t = v.currentTime;
      if (!v.paused) s.watched.add(Math.floor(t / 10));
      s.lastT = t;
    };
    const onPause = () => {
      if (v && !v.ended) s.pauses += 1;
    };
    const onSeek = () => {
      if (v && v.currentTime < s.lastT - 5) s.rewatches += 1;
      s.lastT = v ? v.currentTime : 0;
    };
    const attach = () => {
      const el = videoRef && videoRef.current;
      if (!el || el.tagName !== 'VIDEO' || el === v) return;
      if (v) {
        v.removeEventListener('timeupdate', onTime);
        v.removeEventListener('pause', onPause);
        v.removeEventListener('seeking', onSeek);
      }
      v = el;
      v.addEventListener('timeupdate', onTime);
      v.addEventListener('pause', onPause);
      v.addEventListener('seeking', onSeek);
    };
    const att = setInterval(attach, 1000);
    attach();
    let opened = false;
    const send = () => {
      const body = { kind, ref, title, course, module, open: !opened, activeSec: s.sec, scrollDepth: kind === 'lesson' || kind === 'material' ? s.depth : undefined };
      if (s.dur) {
        body.durationSec = Math.round(s.dur);
        body.watched = [...s.watched];
        body.pauses = s.pauses;
        body.rewatches = s.rewatches;
      }
      opened = true;
      s.sec = 0;
      s.pauses = 0;
      s.rewatches = 0;
      s.watched = new Set();
      api.contentProgress(body);
    };
    const first = setTimeout(send, 5000);
    const iv = setInterval(send, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
      clearInterval(tick);
      clearInterval(att);
      send();
      sc.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', mark, true);
      window.removeEventListener('mousemove', mark, true);
      window.removeEventListener('wheel', mark, true);
      window.removeEventListener('touchstart', mark, true);
      if (v) {
        v.removeEventListener('timeupdate', onTime);
        v.removeEventListener('pause', onPause);
        v.removeEventListener('seeking', onSeek);
      }
      setActivityContext(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, ref, enabled]);
}
