import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Shared pieces of the Attendance ERP screens (admin tab + /employee portal),
// built to the design system on the canvas: badges, KPI tiles, cards,
// ellipsis + tooltip, skeleton / empty / error states, toasts, modal, drawer.

// ── formatting ───────────────────────────────────────────────────────────────
export const IST = 'Asia/Kolkata';
export const hm = (m) => {
  const v = Math.max(0, Math.round(m || 0));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}h ${String(v % 60).padStart(2, '0')}m`;
};
export const hmShort = (m) => {
  const v = Math.max(0, Math.round(m || 0));
  if (v < 60) return `${v}m`;
  return `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m`;
};
export const clock = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
export const dateLabel = (d, o = {}) => new Date(typeof d === 'string' && d.length === 10 ? `${d}T12:00:00+05:30` : d).toLocaleDateString('en-GB', { timeZone: IST, day: 'numeric', month: 'short', ...(o.year !== false ? { year: 'numeric' } : {}), ...(o.weekday ? { weekday: 'short' } : {}) });
export const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: IST });
export const addDays = (k, n) => new Date(new Date(`${k}T12:00:00+05:30`).getTime() + n * 864e5).toLocaleDateString('en-CA', { timeZone: IST });
export const ago = (d, now = Date.now()) => {
  if (!d) return '—';
  const s = Math.max(0, Math.round((now - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
};
export const greet = () => {
  const h = Number(new Date().toLocaleTimeString('en-GB', { timeZone: IST, hour: '2-digit', hour12: false }));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

// ── avatar ───────────────────────────────────────────────────────────────────
const AV = ['#4F46E5', '#0EA5E9', '#16A34A', '#D97706', '#DB2777', '#7C3AED', '#0891B2', '#EA580C'];
export const avColor = (n = '') => AV[[...String(n)].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
export const initials = (n = '') =>
  String(n)
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
export function Av({ name, size = 30, photo }) {
  return (
    <span className="e-av" style={{ width: size, height: size, fontSize: Math.round(size * 0.37), background: avColor(name) }} aria-hidden="true">
      {photo ? <img src={photo} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} /> : initials(name)}
    </span>
  );
}

// ── ellipsis + dark tooltip (point 35) ──────────────────────────────────────
export function Trunc({ text, sub, children, style, className = '', as = 'span' }) {
  const [tip, setTip] = useState(null);
  const ref = useRef(null);
  const show = () => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth + 1 && !sub) return;
    const r = el.getBoundingClientRect();
    setTip({ x: Math.min(r.left, window.innerWidth - 360), y: r.top - 8 });
  };
  const Tag = as;
  return (
    <>
      <Tag ref={ref} className={`e-tr ${className}`} style={style} onMouseEnter={show} onMouseLeave={() => setTip(null)} onTouchStart={show} onTouchEnd={() => setTimeout(() => setTip(null), 1600)}>
        {children || text}
      </Tag>
      {tip &&
        createPortal(
          <div className="e-tip" style={{ left: Math.max(8, tip.x), top: tip.y, transform: 'translateY(-100%)' }} role="tooltip">
            {text}
            {sub && <small>{sub}</small>}
          </div>,
          document.body
        )}
    </>
  );
}

export function Name({ name, sub, photo, size = 30 }) {
  return (
    <div className="e-nm">
      <Av name={name} size={size} photo={photo} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <Trunc as="b" text={name} sub={sub} />
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

// ── badges ───────────────────────────────────────────────────────────────────
const BC = {
  Active: 'g',
  Online: 'g',
  Present: 'g',
  Approved: 'g',
  Completed: 'g',
  'In use': 'g',
  Connected: 'g',
  'Counted as work': 'g',
  Inactive: 'a',
  Late: 'a',
  Pending: 'a',
  'Early Logout': 'a',
  'Not work': 'a',
  'HR: not counted': 'a',
  Offline: 'o',
  'Weekly Off': 'o',
  'Logged out': 'o',
  'Not logged in': 'o',
  Cancelled: 'o',
  Withdrawn: 'o',
  'Not installed': 'o',
  Off: 'o',
  'Half Day': 'v',
  Lunch: 'v',
  Break: 'v',
  Locked: 'v',
  Sleep: 'v',
  Absent: 'r',
  Rejected: 'r',
  Short: 'r',
  Incomplete: 'r',
  'Needs review': 'r',
  'Still inactive': 'r',
  Stopped: 'r',
  Disabled: 'o',
  Leave: 'bl',
  Holiday: 'bl',
  Manual: 'bl',
};
export function B({ children, kind, sm, style }) {
  const label = String(children);
  return (
    <span className={`e-b ${kind || BC[label] || 'o'}${sm ? ' sm' : ''}`} style={style}>
      {children}
    </span>
  );
}
export function StatusBadges({ status, tags = [], sm }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      <B sm={sm}>{status}</B>
      {tags
        .filter((t) => t !== status)
        .map((t) => (
          <B key={t} sm>
            {t}
          </B>
        ))}
    </span>
  );
}

// ── icons (inline stroke svg) ────────────────────────────────────────────────
const P = {
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  check: 'M20 6 9 17l-5-5',
  act: 'M22 12h-4l-3 9L9 3l-3 9H2',
  pause: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM10 9v6M14 9v6',
  cal: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
  x: 'M18 6 6 18M6 6l12 12',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  home: 'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  plus: 'M12 5v14M5 12h14',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  laptop: 'M4 5h16v11H4zM2 19h20',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  chevL: 'm15 18-6-6 6-6',
  chevR: 'm9 18 6-6-6-6',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
};
export function Ic({ n, s = 16, style }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      <path d={P[n]} />
    </svg>
  );
}

// ── cards / KPI ──────────────────────────────────────────────────────────────
export function Card({ title, sub, right, children, pad, className = '', style, bodyStyle, flush }) {
  return (
    <section className={`e-card ${className}`} style={style}>
      {title && (
        <div className="e-ch">
          <div>
            <h2 className="e-ct">{title}</h2>
            {sub && <p className="e-cs">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {flush ? children : <div className={pad === false ? '' : 'e-cb'} style={bodyStyle}>{children}</div>}
    </section>
  );
}
export function Kpi({ label, value, sub, icon, color = '#4F46E5', bg = '#EEF2FF', onClick, active, valueStyle }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="e-kpi" onClick={onClick} style={active ? { borderColor: color, boxShadow: `0 0 0 3px ${color}22` } : undefined} type={onClick ? 'button' : undefined}>
      <div className="e-kl">
        {icon && (
          <span className="e-ki" style={{ background: bg, color }}>
            <Ic n={icon} s={15} />
          </span>
        )}
        {label}
      </div>
      <div className="e-kv" style={valueStyle}>
        {value}
      </div>
      {sub && <div className="e-ks">{sub}</div>}
    </Tag>
  );
}
export function Bar({ pct, color = '#4F46E5', h = 6, style }) {
  return (
    <div className="e-bar" style={{ height: h, ...style }}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct || 0))}%`, background: color }} />
    </div>
  );
}
export const workColor = (pct, inactive) => (pct >= 100 ? '#16A34A' : inactive ? '#F59E0B' : pct >= 75 ? '#4F46E5' : '#F87171');

// ── controls ─────────────────────────────────────────────────────────────────
export function Select({ label, value, onChange, options, style, ariaLabel }) {
  return (
    <label className="e-inp" style={style}>
      {label && <span className="l">{label}</span>}
      <select aria-label={ariaLabel || label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
    </label>
  );
}
export function Search({ value, onChange, placeholder, style }) {
  return (
    <label className="e-inp" style={{ flex: '1 1 220px', ...style }}>
      <Ic n="search" s={15} style={{ color: '#94A3B8' }} />
      <input aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
export function DateInp({ label, value, onChange, type = 'date', style }) {
  return (
    <label className="e-inp" style={style}>
      {label && <span className="l">{label}</span>}
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
    </label>
  );
}
export function Seg({ value, onChange, options }) {
  return (
    <div className="e-seg" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}
export function Toggle({ on, onChange, label }) {
  return <button type="button" className={`e-toggle${on ? ' on' : ''}`} aria-pressed={on} aria-label={label} onClick={() => onChange(!on)} />;
}

// ── states ───────────────────────────────────────────────────────────────────
export function Skeleton({ rows = 5, kpis = 0 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: 4 }} aria-busy="true" aria-label="Loading">
      {kpis > 0 && (
        <div className="e-kpis">
          {Array.from({ length: kpis }).map((_, i) => (
            <div key={i} className="e-sk" style={{ height: 92, borderRadius: 14 }} />
          ))}
        </div>
      )}
      <div className="e-card pad" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="e-sk" style={{ width: 30, height: 30, borderRadius: '50%' }} />
            <div className="e-sk" style={{ flex: 2 }} />
            <div className="e-sk" style={{ flex: 1 }} />
            <div className="e-sk" style={{ flex: 1 }} />
            <div className="e-sk" style={{ width: 70, height: 20, borderRadius: 999 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
export function Empty({ title, text, action, icon = 'check' }) {
  return (
    <div className="e-state">
      <div className="ic" style={{ background: 'var(--e-priS)', color: 'var(--e-pri)' }}>
        <Ic n={icon} s={28} />
      </div>
      <b>{title}</b>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}
export function ErrorState({ text, onRetry }) {
  return (
    <div className="e-state">
      <div className="ic" style={{ background: 'rgba(220,38,38,.1)', color: '#B91C1C' }}>
        !
      </div>
      <b>Couldn't load this</b>
      <p>{text || 'The server did not answer. Nothing was lost — tracking keeps running in the background.'}</p>
      {onRetry && (
        <button type="button" className="e-btn p" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

// ── data hook ────────────────────────────────────────────────────────────────
export function useLoad(fn, deps = [], { poll } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const ref = useRef(fn);
  ref.current = fn;
  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    const r = await ref.current();
    if (r && r.success) {
      setData(r.result);
      setError(null);
    } else if (!silent || !data) setError((r && r.message) || 'Failed');
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    if (!poll) return undefined;
    const id = setInterval(() => !document.hidden && load(true), poll);
    return () => clearInterval(id);
  }, [poll, load]);
  return { data, loading, error, reload: load, setData };
}

// live refresh on the socket event the backend sends on every status change
export function useErpLive(onChange) {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    let sock;
    let t;
    const h = () => {
      clearTimeout(t);
      t = setTimeout(() => ref.current && ref.current(), 800);
    };
    import('@/socket')
      .then((m) => {
        sock = m.getSocket && m.getSocket();
        if (sock) sock.on('erp:attendance', h);
      })
      .catch(() => {});
    return () => {
      clearTimeout(t);
      if (sock) sock.off('erp:attendance', h);
    };
  }, []);
}

// ticking clock for "20 s ago"
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// ── toasts (bottom-right, 4 s, max 3) ───────────────────────────────────────
const ToastCtx = createContext({ push: () => {} });
export function ToastProvider({ children }) {
  const [list, setList] = useState([]);
  const push = useCallback((kind, title, text) => {
    const id = Math.random().toString(36).slice(2);
    setList((l) => [...l.slice(-2), { id, kind, title, text }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 4000);
  }, []);
  const C = { ok: ['#16A34A', '✓'], info: ['#4F46E5', 'i'], err: ['#DC2626', '!'] };
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      {createPortal(
        <div className="e-toasts" aria-live="polite">
          {list.map((t) => (
            <div key={t.id} className="e-toast">
              <span className="ti" style={{ background: C[t.kind][0] }}>
                {C[t.kind][1]}
              </span>
              <div>
                <b>{t.title}</b>
                {t.text && <span>{t.text}</span>}
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => {
  const { push } = useContext(ToastCtx);
  return {
    ok: (t, s) => push('ok', t, s),
    info: (t, s) => push('info', t, s),
    err: (t, s) => push('err', t, s),
    // show the API result: success → ok, else error
    res: (r, okTitle) => (r && r.success ? push('ok', okTitle || r.message || 'Saved') : push('err', (r && r.message) || 'Something went wrong')),
  };
};

// ── modal / drawer ───────────────────────────────────────────────────────────
export function Modal({ open, onClose, children, wide, label }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="erp">
      <div className="e-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
        <div className={`e-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
export function Drawer({ open, onClose, children, label }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="erp">
      <div className="e-drawer-back" onMouseDown={onClose} />
      <aside className="e-drawer" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </aside>
    </div>,
    document.body
  );
}
export function ModalHead({ title, sub, onClose }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14 }}>
      <div style={{ flex: 1 }}>
        <h2 className="e-ct" style={{ fontSize: 17 }}>
          {title}
        </h2>
        {sub && <p className="e-cs">{sub}</p>}
      </div>
      {onClose && (
        <button type="button" className="e-btn sm" aria-label="Close" onClick={onClose}>
          <Ic n="x" s={14} />
        </button>
      )}
    </div>
  );
}

// pager for client-side lists
export function usePager(list, size = 10) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil((list || []).length / size));
  useEffect(() => {
    if (page > pages) setPage(1);
  }, [pages, page]);
  const rows = (list || []).slice((page - 1) * size, page * size);
  const Pager = () =>
    pages > 1 ? (
      <span className="e-row" style={{ gap: 6 }}>
        <button type="button" className="e-btn sm" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
          ‹
        </button>
        {Array.from({ length: Math.min(pages, 7) }).map((_, i) => (
          <button key={i} type="button" className="e-btn sm" onClick={() => setPage(i + 1)} style={page === i + 1 ? { background: 'var(--e-priS)', color: 'var(--e-priD)', borderColor: '#C7D2FE' } : undefined}>
            {i + 1}
          </button>
        ))}
        <button type="button" className="e-btn sm" disabled={page === pages} onClick={() => setPage(page + 1)} aria-label="Next page">
          ›
        </button>
      </span>
    ) : null;
  return { rows, page, pages, Pager, from: (list || []).length ? (page - 1) * size + 1 : 0, to: Math.min(page * size, (list || []).length) };
}
