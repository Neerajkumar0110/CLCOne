import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Skeleton } from 'antd';
import '../components/LearnerDesign.css';

// Shared bits for the Project Manager boards (design canvas page 4, P1–P10):
// the indigo `.ld-page.pm` shell, a loader hook and the board tabs. Each board
// keeps the existing full page reachable from a tab, so nothing the old page
// could do is lost.

export const fmtDay = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
export const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
export const fmtDayTime = (v) => (v ? `${fmtDay(v)} ${fmtTime(v)}` : '—');
export const initials = (n) =>
  String(n || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
export const shortName = (n) => {
  const p = String(n || '').trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || '';
};
export const res = (r) => (r && r.result !== undefined ? r.result : r);
export const errText = (e, fallback) => (e && (e.message || (e.response && e.response.data && e.response.data.message))) || fallback;

// load(fn) → { data, loading, error, reload }. fn is re-run when deps change.
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const alive = useRef(true);
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fn();
      if (alive.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (alive.current) setState({ data: null, loading: false, error: errText(e, 'Could not load.') });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    alive.current = true;
    run();
    return () => {
      alive.current = false;
    };
  }, [run]);
  return { ...state, reload: run };
}

export function PMPage({ title, sub, right, children, style }) {
  return (
    <div className="ld-page pm" style={style}>
      <div className="ld-hd" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {title && <h1>{title}</h1>}
          {sub && <div className="ld-muted" style={{ fontSize: 14 }}>{sub}</div>}
        </div>
        {right && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}

export function PMTabs({ tabs, value, onChange }) {
  return (
    <div className="ld-tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={`ld-tab lg${value === k ? ' on' : ''}`} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// The existing full page, inside a board tab — every old feature stays.
export function Legacy({ children }) {
  return (
    <div className="pm-legacy">
      <Suspense fallback={<Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />}>{children}</Suspense>
    </div>
  );
}

export function Loading() {
  return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;
}

export function BatchSelect({ batches, value, onChange }) {
  if (!batches || batches.length < 2) return null;
  return (
    <select className="ld-inp" aria-label="Batch" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {batches.map((b) => {
        const name = typeof b === 'string' ? b : b.name;
        return <option key={name} value={name}>{name}</option>;
      })}
    </select>
  );
}

// ?tab= in the URL keeps the chosen board tab across reloads
export function useTab(def) {
  const read = () => {
    try {
      return new URLSearchParams(window.location.search).get('tab') || def;
    } catch (e) {
      return def;
    }
  };
  const [tab, setTab] = useState(read);
  const change = (t) => {
    setTab(t);
    try {
      const u = new URL(window.location.href);
      if (t === def) u.searchParams.delete('tab');
      else u.searchParams.set('tab', t);
      window.history.replaceState(window.history.state, '', u.toString());
    } catch (e) {
      /* noop */
    }
  };
  return [tab, change];
}
