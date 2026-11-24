import React, { useEffect, useState } from 'react';
import { TONE, I, Chip, timerTone, splitMs } from './ui';

// Shared bits of the project screens (Figma 2B–2G): status chips in the
// design-system colours, a ticking clock and the "time left" pill.

export const STATUS = {
  allocated: ['Allocated', 'mut'],
  in_progress: ['In Progress', 'sky'],
  submitted: ['Submitted', 'ind'],
  under_review: ['Under Review', 'pu'],
  qualified: ['Qualified', 'ok'],
  not_qualified: ['Not Qualified', 'or'],
  disqualified: ['Disqualified', 'er'],
  extension: ['Extension requested', 'pk'],
};
export const statusOf = (a) => (a.extension && a.extension.status === 'pending' && ['allocated', 'in_progress'].includes(a.status) ? 'extension' : a.status);

export function StatusChip({ a, s }) {
  const [l, t] = STATUS[statusOf(a)] || [a.status, 'mut'];
  return (
    <Chip tone={t} dot s={s}>
      {l}
    </Chip>
  );
}

// a clock that ticks every 30 s, corrected by the server's time
export function useNow(serverNow, every = 30000) {
  const [skew] = useState(() => (serverNow ? new Date(serverNow).getTime() - Date.now() : 0));
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now() + skew), every);
    return () => clearInterval(iv);
  }, [skew, every]);
  return now;
}

export const dhm = (ms) => {
  const { d, h, m } = splitMs(ms);
  return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
};

// what the timer shows for an allocation right now
export function timerOf(a, now) {
  const stopped = !!a.submittedAt;
  if (stopped) {
    const t = a.timeTakenMs || new Date(a.submittedAt) - new Date(a.startAt || a.allocatedAt);
    if (a.status === 'qualified') return { tone: 'mut', text: 'Done', ms: t, stopped };
    if (a.status === 'not_qualified' && a.resubmit && a.resubmit.allowed && a.resubmit.deadline) {
      const left = new Date(a.resubmit.deadline) - now;
      return { tone: left > 0 ? 'wa' : 'er', text: left > 0 ? `Resubmit · ${Math.ceil(left / 86400000)}d` : 'Resubmit closed', ms: left, stopped };
    }
    return { tone: 'mut', text: `Stopped · ${dhm(t).replace(/ \d+m$/, '')}`, ms: t, stopped };
  }
  if (a.status === 'disqualified') return { tone: 'er', text: 'Deadline passed', ms: 0, stopped: true };
  if (a.startAt && new Date(a.startAt) > now) return { tone: 'mut', text: `Starts in ${dhm(new Date(a.startAt) - now)}`, ms: new Date(a.startAt) - now, notStarted: true };
  const left = new Date(a.deadline) - now;
  const [tone] = timerTone(left, false);
  return { tone, text: left > 0 ? dhm(left) : 'Deadline passed', ms: left };
}

export function TimePill({ a, now }) {
  const t = timerOf(a, now);
  const tt = TONE[t.tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: tt[0], color: tt[1], borderRadius: 6, padding: '3px 8px', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <I n="timer" s={12} />
      {t.text}
    </span>
  );
}

export const fmtDT = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtShort = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
export const toLocalInput = (d) => {
  if (!d) return '';
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
};
export const kb = (b) => (!b ? '' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export const fileTone = (name) => {
  const e = String(name || '').split('.').pop().toLowerCase();
  return e === 'pdf' ? 'er' : e === 'zip' || e === 'rar' ? 'ind' : e === 'csv' || e === 'xlsx' ? 'sky' : e === 'ipynb' ? 'or' : 'mut';
};
