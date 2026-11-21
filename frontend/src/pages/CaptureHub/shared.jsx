import React, { useEffect, useState } from 'react';
import axios from 'axios';
import dayjs from 'dayjs';
import { API_BASE_URL, BASE_URL } from '@/config/serverApiConfig';
import storePersist from '@/redux/storePersist';
import { STAGE_NAMES } from '@/config/leadStages';

// ── icons: the design's own stroke icons (feather style) ──────────────────────
const P = {
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  user: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>,
  userPlus: <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></>,
  bars: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
  list: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>,
  layers: <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>,
  form: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
  search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  cal: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
  filter: <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  check: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
  trophy: <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></>,
  xcircle: <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>,
  trend: <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>,
  swap: <><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />,
  chat: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  inbox: <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  alert: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  ext: <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><line x1="14" y1="14" x2="14" y2="14.01" /><line x1="21" y1="14" x2="21" y2="21" /><line x1="14" y1="21" x2="17" y2="21" /><line x1="17" y1="14" x2="17" y2="17" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
};
const FILLED = {
  more: <><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></>,
  facebook: <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07z" />,
  google: <path d="M12.24 10.29v3.5h4.95c-.2 1.27-1.5 3.73-4.95 3.73-2.98 0-5.41-2.47-5.41-5.52s2.43-5.52 5.41-5.52c1.7 0 2.83.72 3.48 1.34l2.37-2.28C16.6 4.13 14.6 3.2 12.24 3.2 7.4 3.2 3.48 7.12 3.48 12s3.92 8.8 8.76 8.8c5.06 0 8.41-3.55 8.41-8.56 0-.58-.06-1.02-.14-1.45z" />,
  linkedin: <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45z" />,
  youtube: <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z" />,
};
export function Ic({ n, s = 16, w = 2, color, style }) {
  if (FILLED[n]) return <svg width={s} height={s} viewBox="0 0 24 24" fill={color || 'currentColor'} aria-hidden="true" style={style}>{FILLED[n]}</svg>;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {P[n]}
    </svg>
  );
}

// ── channels (the backend's grouping in leadController/insights.js) ───────────
// icon, brand colour, tile tint and the fixed chart colour per channel
export const CHANNEL = {
  'Capture Form': { short: 'Capture Form', icon: 'file', brand: '#0284C7', tint: '#E6F6FD', chart: '#5B47D1', utm: 'Website' },
  'Meta (Facebook / Instagram)': { short: 'Meta', icon: 'facebook', brand: '#1877F2', tint: '#E7F0FE', chart: '#2A78D6', utm: 'Facebook' },
  Google: { short: 'Google', icon: 'google', brand: '#EA4335', tint: '#FDEDEC', chart: '#EDA100', utm: 'Google Ads' },
  LinkedIn: { short: 'LinkedIn', icon: 'linkedin', brand: '#0A66C2', tint: '#E8F0FA', chart: '#0A66C2', utm: 'LinkedIn' },
  YouTube: { short: 'YouTube', icon: 'youtube', brand: '#E10000', tint: '#FDECEC', chart: '#E34948', utm: 'YouTube' },
  WhatsApp: { short: 'WhatsApp', icon: 'chat', brand: '#128C7E', tint: '#E6F7F2', chart: '#1BAF7A', utm: 'WhatsApp' },
  Referral: { short: 'Referral', icon: 'users', brand: '#7C3AED', tint: '#F0EEFC', chart: '#008300' },
  Import: { short: 'Import', icon: 'download', brand: '#64748B', tint: '#EEF2F6', chart: '#EB6834' },
  'Calls / Manual': { short: 'Calls / Manual', icon: 'phone', brand: '#0F766E', tint: '#E6F4F1', chart: '#94A3B8' },
  Other: { short: 'Other', icon: 'layers', brand: '#64748B', tint: '#EEF2F6', chart: '#CBD5E1' },
  Unknown: { short: 'Unknown', icon: 'alert', brand: '#64748B', tint: '#EEF2F6', chart: '#CBD5E1' },
};
export const chMeta = (name) => CHANNEL[name] || CHANNEL.Other;
export const CHANNEL_NAMES = Object.keys(CHANNEL);

export function ChannelIcon({ name, size = 44, icon = 22, radius = 12 }) {
  const m = chMeta(name);
  return (
    <span className="ch2-lo" style={{ width: size, height: size, borderRadius: radius, background: m.tint, color: m.brand }}>
      <Ic n={m.icon} s={icon} />
    </span>
  );
}

// ── formatting ────────────────────────────────────────────────────────────────
export const nf = (n) => Number(n || 0).toLocaleString('en-IN');
export const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
export const fmtDay = (d) => (d ? dayjs(d).format('D MMM YYYY') : '—');
export const fmtWhen = (d) => (d ? dayjs(d).format('D MMM YYYY, h:mm a') : '—');
export const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
export const maskPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} •••••` : p || '';
};
export const waLink = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d ? `https://wa.me/${d.length === 10 ? `91${d}` : d}` : null;
};
export function lastActivityText(d) {
  if (!d) return '—';
  const x = dayjs(d);
  if (x.isSame(dayjs(), 'day')) return `Today, ${x.format('h:mm a')}`;
  if (x.isSame(dayjs().subtract(1, 'day'), 'day')) return `Yesterday, ${x.format('h:mm a')}`;
  return x.format('D MMM');
}

export const STAGE_TONE = {
  'Not Interested Leads': 'rd', 'Invalid Leads': 'rd', Enrolled: 'gr', Prospects: 'gr', 'Demo Booking': 'bl',
  'Interested Leads': 'bl', 'Connected Leads': 'bl', Callback: 'or', 'Future Prospect': 'or', 'No Response': 'gy', 'New Lead': 'bl',
};
export const stageLabel = (s) => String(s || 'No stage').replace(/ Leads$/, '');
export const quality = (r) =>
  r.converted ? ['Converted', 'gr'] : r.qualified ? ['Qualified', 'gr'] : r.rejected ? ['Rejected', 'rd'] : ['Still being worked', 'or'];

// ── filters (one set for Overview + All Leads + the export) ───────────────────
export const PRESETS = [
  ['today', 'Today', () => [dayjs().startOf('day'), dayjs().endOf('day')]],
  ['yesterday', 'Yesterday', () => [dayjs().subtract(1, 'day').startOf('day'), dayjs().subtract(1, 'day').endOf('day')]],
  ['7d', 'Last 7 days', () => [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')]],
  ['30d', 'Last 30 days', () => [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')]],
  ['month', 'This month', () => [dayjs().startOf('month'), dayjs().endOf('day')]],
  ['lastMonth', 'Last month', () => [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')]],
  ['90d', 'Last 90 days', () => [dayjs().subtract(89, 'day').startOf('day'), dayjs().endOf('day')]],
  ['year', 'Last 12 months', () => [dayjs().subtract(1, 'year').add(1, 'day').startOf('day'), dayjs().endOf('day')]],
  ['custom', 'Custom range', null],
];
export const SORTS = [
  ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['name', 'Name A–Z'], ['stage', 'Stage'], ['source', 'Source'], ['owner', 'Sales user'],
];
export const QUALITY = [['qualified', 'Qualified'], ['converted', 'Converted'], ['rejected', 'Rejected'], ['working', 'Still being worked']];
export const BLANK = { preset: '30d', from: '', to: '', channel: '', stage: '', quality: '', assignedUser: '', q: '', sort: 'newest' };

export function rangeOf(f) {
  if (f.preset === 'custom') {
    const from = f.from ? dayjs(f.from).startOf('day') : dayjs().subtract(29, 'day').startOf('day');
    const to = f.to ? dayjs(f.to).endOf('day') : dayjs().endOf('day');
    return [from, to];
  }
  return (PRESETS.find((p) => p[0] === f.preset) || PRESETS[3])[2]();
}
export const presetLabel = (f) =>
  f.preset === 'custom' ? `${f.from ? dayjs(f.from).format('D MMM') : '…'} – ${f.to ? dayjs(f.to).format('D MMM YYYY') : 'today'}` : (PRESETS.find((p) => p[0] === f.preset) || PRESETS[3])[1];

export function queryOf(f, extra = {}) {
  const [from, to] = rangeOf(f);
  const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  ['channel', 'stage', 'quality', 'assignedUser', 'q'].forEach((k) => f[k] && qs.set(k, f[k]));
  Object.entries(extra).forEach(([k, v]) => v != null && v !== '' && qs.set(k, v));
  return qs.toString();
}

export function useDebounced(value, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// The filter card both Overview and All Leads show.
export function FilterBar({ f, setF, draftQ, setDraftQ, users, showQuality, showSort, note, isManager }) {
  const [more, setMore] = useState(false);
  const [sheet, setSheet] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const userName = (id) => (id === 'none' ? 'Unassigned' : users.find((u) => u._id === id)?.name || 'Sales user');
  const chips = [];
  chips.push([presetLabel(f), f.preset !== '30d' ? () => setF((o) => ({ ...o, preset: '30d', from: '', to: '' })) : null, 'date range']);
  if (f.q) chips.push([`“${f.q}”`, () => { setDraftQ(''); set('q', ''); }, 'search']);
  if (f.channel) chips.push([`Source: ${chMeta(f.channel).short}`, () => set('channel', ''), 'source']);
  if (f.stage) chips.push([`Stage: ${stageLabel(f.stage)}`, () => set('stage', ''), 'stage']);
  if (f.quality) chips.push([`Quality: ${QUALITY.find((x) => x[0] === f.quality)?.[1]}`, () => set('quality', ''), 'quality']);
  if (f.assignedUser) chips.push([`Sales user: ${userName(f.assignedUser)}`, () => set('assignedUser', ''), 'sales user']);
  const active = chips.filter((c) => c[1]).length;
  const showQ = showQuality || more;
  const showS = showSort || more;
  return (
    <>
      {sheet && <div className="ch2-ov" onClick={() => setSheet(false)} aria-hidden="true" />}
      <section aria-label="Filters" className={`ch2-filters${sheet ? ' sheet' : ''}`}>
        <div className="ch2-sheet-h">
          <span style={{ width: 40, height: 4, borderRadius: 2, background: '#CBD5E1', alignSelf: 'center' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b>Filters</b>
            <button type="button" className="ch2-linkbtn" onClick={() => { setDraftQ(''); setF((o) => ({ ...BLANK, sort: o.sort })); }}>Clear all</button>
          </div>
        </div>
        <div className="ch2-frow main">
          <label className="ch2-search">
            <Ic n="search" />
            <input aria-label="Search leads" placeholder="Search name, phone, email or campaign…" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} />
            {draftQ && <button type="button" className="ch2-ib" style={{ width: 26, height: 26, border: 0 }} aria-label="Clear search" onClick={() => setDraftQ('')}><Ic n="x" s={14} /></button>}
          </label>
          <span className="ch2-sel">
            <Ic n="cal" color="var(--c-muted)" />
            <select aria-label="Date range" value={f.preset} onChange={(e) => set('preset', e.target.value)}>
              {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </span>
          {f.preset === 'custom' && (
            <>
              <span className="ch2-sel" style={{ paddingRight: 12 }}><input type="date" aria-label="From date" value={f.from} max={f.to || undefined} onChange={(e) => set('from', e.target.value)} /></span>
              <span className="ch2-sel" style={{ paddingRight: 12 }}><input type="date" aria-label="To date" value={f.to} min={f.from || undefined} onChange={(e) => set('to', e.target.value)} /></span>
            </>
          )}
          <span className="ch2-sel">
            <select aria-label="Source" value={f.channel} onChange={(e) => set('channel', e.target.value)}>
              <option value="">Source: All</option>
              {CHANNEL_NAMES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </span>
          <span className="ch2-sel">
            <select aria-label="Stage" value={f.stage} onChange={(e) => set('stage', e.target.value)}>
              <option value="">Stage: All</option>
              {STAGE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </span>
          {showQ && (
            <span className="ch2-sel">
              <select aria-label="Quality" value={f.quality} onChange={(e) => set('quality', e.target.value)}>
                <option value="">Quality: All</option>
                {QUALITY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </span>
          )}
          {isManager && (
            <span className="ch2-sel">
              <select aria-label="Sales user" value={f.assignedUser} onChange={(e) => set('assignedUser', e.target.value)}>
                <option value="">Sales user: Everyone</option>
                <option value="none">Unassigned</option>
                {users.map((u) => <option key={u._id} value={u._id}>{u.name} {u.surname || ''}</option>)}
              </select>
            </span>
          )}
          {showS && (
            <span className="ch2-sel">
              <select aria-label="Sort" value={f.sort} onChange={(e) => set('sort', e.target.value)}>
                {SORTS.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}
              </select>
            </span>
          )}
          {!(showQuality && showSort) && (
            <button type="button" className="ch2-btn" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              <Ic n="filter" />{more ? 'Fewer filters' : 'More filters'}
            </button>
          )}
          <button type="button" className="ch2-btn ch2-fbtn" onClick={() => setSheet(true)}>Filters{active ? ` · ${active}` : ''}</button>
        </div>
        <div className="ch2-frow" style={{ gap: 8 }}>
          {chips.map(([label, clear, what]) => (
            <span className="ch2-chip" key={what} style={clear ? undefined : { paddingRight: 12 }}>
              {label}
              {clear && <button type="button" aria-label={`Remove ${what} filter`} onClick={clear}><Ic n="x" s={13} /></button>}
            </span>
          ))}
          {active > 0 && <button type="button" className="ch2-linkbtn" style={{ marginLeft: 4 }} onClick={() => { setDraftQ(''); setF((o) => ({ ...BLANK, sort: o.sort })); }}>Clear all</button>}
          {note && <span className="mut" style={{ fontSize: 12.5, marginLeft: 'auto' }}>{note}</span>}
        </div>
        {sheet && <button type="button" className="ch2-btn p" style={{ minHeight: 48 }} onClick={() => setSheet(false)}>Show leads</button>}
      </section>
    </>
  );
}

// ── states ────────────────────────────────────────────────────────────────────
export const Skel = ({ h = 120, style }) => <div className="ch2-skel" style={{ height: h, ...style }} />;
export function EmptyState({ onClear, title = 'No leads found', text = 'Try changing your filters or date range.' }) {
  return (
    <div className="ch2-state">
      <Ic n="inbox" s={34} w={1.8} color="#94A3B8" />
      <b>{title}</b>
      <span className="mut">{text}</span>
      {onClear && <button type="button" className="ch2-btn" onClick={onClear}>Clear filters</button>}
    </div>
  );
}
export function ErrorState({ onRetry }) {
  return (
    <div className="ch2-state err" role="alert">
      <Ic n="alert" s={34} w={1.8} color="#B42318" />
      <b>Unable to load leads.</b>
      <span className="mut">Please try again.</span>
      <button type="button" className="ch2-btn p" onClick={onRetry}>Retry</button>
    </div>
  );
}

// ── API helpers that request.js has no shape for ──────────────────────────────
const auth = () => {
  const t = storePersist.get('auth')?.current?.token;
  return t ? { Authorization: `Bearer ${t}` } : {};
};
export async function apiPut(path, body) {
  try {
    const { data } = await axios.put(API_BASE_URL + path, body, { headers: auth(), withCredentials: true });
    return data;
  } catch (e) {
    return e?.response?.data || { success: false, message: 'Network error — please try again.' };
  }
}
export async function apiDelete(path) {
  try {
    const { data } = await axios.delete(API_BASE_URL + path, { headers: auth(), withCredentials: true });
    return data;
  } catch (e) {
    return e?.response?.data || { success: false, message: 'Network error — please try again.' };
  }
}
export async function apiDownload(path, filename) {
  const res = await axios.get(API_BASE_URL + path, { headers: auth(), responseType: 'blob', withCredentials: true });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// The public capture form: hosted link per channel + embed code.
export const PUBLIC_BASE = String(BASE_URL || '').replace(/\/?$/, '/');
export function formLink(source, campaign) {
  const qs = new URLSearchParams();
  if (source) qs.set('utm_source', source);
  if (campaign) qs.set('utm_campaign', campaign);
  const s = qs.toString().replace(/\+/g, '%20');
  return `${PUBLIC_BASE}public/lead-form/website${s ? `?${s}` : ''}`;
}
export const embedCode = (source = 'Website') =>
  `<div id="clc-lead-form"></div>\n<script src="${PUBLIC_BASE}public/lead-form/embed.js"\n  data-source="${source}" async></script>`;

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    t.remove();
    return ok;
  }
}

export const FULL_ACCESS = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Team Manager'];
