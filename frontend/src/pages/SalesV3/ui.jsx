import React, { useEffect } from "react";
import { createPortal } from "react-dom";

// Shared pieces of the v3 design (Sales One Place) — markup and class names
// exactly as the design canvas uses them (.ov/.md/.mh/.mb/.mf, .pager/.pb,
// .state, .skel …). Styles: sv3.css (the design's sales-ui.css, scoped .sv3).

export const nf = (n) => Number(n || 0).toLocaleString("en-IN");
export const inr = (n) => `₹${nf(Math.round(Number(n) || 0))}`;
export const initials = (name) =>
  String(name || "")
    .replace(/[^A-Za-z\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "#";
export const IST = { timeZone: "Asia/Kolkata" };
export const fmtWhen = (v) => {
  const d = v && new Date(v);
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { ...IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};
export const fmtDay = (v) => {
  const d = v && new Date(v);
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short", year: "numeric" });
};
export const talk = (s) => {
  const n = Math.round(Number(s) || 0);
  if (!n) return "0s";
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
};
export const hm = (min) => {
  const m = Math.round(Number(min) || 0);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};

// Stage → design badge colour.
const STAGE_B = {
  "New Lead": "b tl",
  "Fresh Leads": "b tl",
  "Connected Leads": "b bl",
  "Interested Leads": "b bl",
  Callback: "b or",
  "Demo Booking": "b bl",
  Prospects: "b tl",
  "Future Prospect": "b bl",
  Enrolled: "b gr",
  "No Response": "b gy",
  "Not Interested Leads": "b rd",
  "Invalid Leads": "b rd",
};
export const stageBadge = (s) => STAGE_B[s] || "b gy";

// Popup — .ov > .md(.mh .mb .mf), rendered in <body> inside .sv3 so the design CSS applies.
export function Modal({ open = true, title, sub, onClose, width = 640, footer, children, label }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="sv3">
      <div className="ov" role="dialog" aria-modal="true" aria-label={label || (typeof title === "string" ? title : "Dialog")} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
        <div className="md" style={{ maxWidth: width }}>
          <div className="mh">
            <div>
              <b>{title}</b>
              {sub && <small>{sub}</small>}
            </div>
            <button type="button" className="ib" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="mb">{children}</div>
          {footer && <div className="mf">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Pager — "1–20 of 340", rows per page, ‹ 1 2 3 ›.
export function Pager({ page, pages, count, per, pers = [10, 20, 50, 100], onPer, onPage, noun = "" }) {
  const total = Math.max(1, pages || 1);
  const from = count ? (page - 1) * per + 1 : 0;
  const to = Math.min(page * per, count || 0);
  const start = Math.max(1, Math.min(page - 2, total - 4));
  const nums = [];
  for (let i = start; i <= Math.min(total, start + 4); i++) nums.push(i);
  return (
    <div className="pager">
      <span>{count ? `${from}–${to} of ${nf(count)}${noun ? ` ${noun}` : ""}` : `0${noun ? ` ${noun}` : ""}`}</span>
      <div className="pp">
        {onPer && (
          <label className="row" style={{ gap: 6 }}>
            Rows per page
            <select className="sel" style={{ width: "auto", minHeight: 36 }} value={per} onChange={(e) => onPer(Number(e.target.value))} aria-label="Rows per page">
              {pers.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="pb" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</button>
        {nums.map((n) => (
          <button key={n} type="button" className={n === page ? "pb on" : "pb"} aria-current={n === page ? "page" : undefined} onClick={() => n !== page && onPage(n)}>{n}</button>
        ))}
        <button type="button" className="pb" onClick={() => onPage(page + 1)} disabled={page >= total} aria-label="Next page">›</button>
      </div>
    </div>
  );
}

// Loading / empty / error states (spec: every chart and list has all three).
export function Skel({ h = 180 }) {
  return <div className="skel" style={{ height: h }} />;
}
export function Empty({ text = "No data available for the selected filters.", sub, action }) {
  return (
    <div className="state">
      <b>{text}</b>
      {sub}
      {action}
    </div>
  );
}
export function Fail({ onRetry, text = "Couldn’t load this." }) {
  return (
    <div className="state err">
      <b>{text}</b>The rest of the page still works.
      {onRetry && <button type="button" className="btn sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

// Page header (.ph)
export function Head({ crumb, title, lead, children }) {
  return (
    <div className="ph">
      <div>
        <div className="crumb">{crumb}</div>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

// Search box (.srch)
export function Search({ value, onChange, onEnter, placeholder, label }) {
  return (
    <label className="srch">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5B6B79" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
      <input type="search" aria-label={label || placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onEnter?.(e.currentTarget.value)} />
    </label>
  );
}

// Segmented buttons (.seg)
export function Seg({ items, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {items.map(([k, l]) => (
        <button key={k || "all"} type="button" className={value === k ? "on" : ""} aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

// Tabs (.tabs/.tab)
export function Tabs({ items, value, onChange, label }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map(([k, l, n]) => (
        <button key={k} type="button" className={value === k ? "tab on" : "tab"} aria-current={value === k ? "page" : undefined} onClick={() => onChange(k)}>
          {l}
          {n !== undefined && n !== null && <span className="n">{n}</span>}
        </button>
      ))}
    </nav>
  );
}
