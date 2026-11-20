import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Popover } from 'antd';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { request } from '@/request';
import { getSocket } from '@/socket';
import AdChatInbox from '@/pages/Leads/AdChatInbox';
import ChatStatsModal from './ChatStatsModal';
import './chatChannels.css';

// Header: Facebook Messenger / WhatsApp / Instagram chat icons with unread
// counts (user ask 2026-11-15). Owner + Super Admin only — the same people
// the Ad chat inbox API allows. Counts come from GET /facebook/chats
// (byChannel); a "lead:chat" socket event refetches them instantly and
// pulses the icon of the channel that just got a message.

const SUPER_ADMIN_ROLES = ['owner', 'Super Admin'];

const Messenger = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.14.26.35.27.57l.05 1.78a.8.8 0 0 0 1.12.71l1.99-.88a.8.8 0 0 1 .53-.04c.91.25 1.88.39 2.9.39 5.64 0 10-4.13 10-9.7S17.64 2 12 2Zm6 7.46-2.94 4.66a1.5 1.5 0 0 1-2.17.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63l2.94-4.66a1.5 1.5 0 0 1 2.17-.4l2.34 1.75a.6.6 0 0 0 .72 0l3.16-2.4c.42-.32.97.18.69.63Z"
    />
  </svg>
);
const WhatsApp = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
    <path
      fill="currentColor"
      d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35ZM12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.32l-.34-.2-3.57.94.95-3.48-.22-.36a9.43 9.43 0 0 1-1.44-5.01c0-5.2 4.24-9.44 9.45-9.44a9.38 9.38 0 0 1 6.68 2.77 9.38 9.38 0 0 1 2.76 6.68c0 5.21-4.24 9.44-9.45 9.44Zm8.04-17.48A11.3 11.3 0 0 0 12.05.7C5.78.7.68 5.8.68 12.06c0 2 .52 3.96 1.52 5.68L.58 23.65l6.04-1.58a11.33 11.33 0 0 0 5.43 1.38h.01c6.26 0 11.36-5.1 11.36-11.37 0-3.03-1.18-5.89-3.33-8.03Z"
    />
  </svg>
);
const Instagram = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16ZM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.3-1.46.72-2.13 1.38A5.88 5.88 0 0 0 .63 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.38 2.13a5.88 5.88 0 0 0 2.13 1.38c.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.88 5.88 0 0 0 2.13-1.38 5.88 5.88 0 0 0 1.38-2.13c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.88 5.88 0 0 0-1.38-2.13A5.88 5.88 0 0 0 19.86.63C19.1.33 18.22.13 16.95.07 15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z"
    />
  </svg>
);

const CHANNELS = [
  { key: 'messenger', label: 'Messenger', Icon: Messenger },
  { key: 'whatsapp', label: 'WhatsApp', Icon: WhatsApp },
  { key: 'instagram', label: 'Instagram', Icon: Instagram },
];

const ago = (d) => {
  if (!d) return '';
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const initials = (n) =>
  String(n || '?')
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
const stripAd = (t) => String(t || '').replace(/^\[Ad[^\]]*\]\s*/, '');

function ChannelPanel({ channel, onOpenChat, onOpenAll, onOpenReport }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const res = await request.get({ entity: `facebook/chats?channel=${channel.key}&limit=8` });
    if (res?.success) {
      setRows(res.result.rows);
      setErr('');
    } else setErr(res?.message || 'Could not load chats.');
  }, [channel.key]);

  useEffect(() => {
    load();
    const s = getSocket();
    const on = (p) => (!p?.channel || p.channel === channel.key) && load();
    s?.on('lead:chat', on);
    return () => s?.off('lead:chat', on);
  }, [load, channel.key]);

  const unread = (rows || []).filter((r) => r.unread).length;
  return (
    <div className={`cc-panel cc-${channel.key}`}>
      <div className="cc-panel-head">
        <span className="cc-panel-logo">
          <channel.Icon />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{channel.label} chats</b>
          <small>{rows ? (unread ? `${unread} unread · live` : 'All caught up · live') : 'Loading…'}</small>
        </div>
        {/* full report: chats today, called, spoke, didn't pick up, results */}
        <button type="button" className="cc-report-btn" onClick={onOpenReport} title={`${channel.label} report — chats, calls, results`}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z" /></svg>
          Report
        </button>
      </div>
      <div className="cc-list">
        {err && <div className="cc-empty">{err}</div>}
        {rows && !rows.length && !err && <div className="cc-empty">No {channel.label} chats yet.</div>}
        {!rows && !err && <div className="cc-empty">Loading…</div>}
        {(rows || []).map((r) => (
          <button key={r._id} type="button" className={`cc-row ${r.unread ? 'is-unread' : ''}`} onClick={() => onOpenChat(r)}>
            <span className="cc-avatar">{initials(r.name)}</span>
            <span className="cc-row-main">
              <span className="cc-row-top">
                <span className="cc-name">{r.name}</span>
                <span className="cc-time">{ago(r.chatLastAt)}</span>
              </span>
              <span className="cc-msg">{stripAd(r.chatLastMessage) || '—'}</span>
            </span>
            {r.unread && <span className="cc-dot" aria-label="unread" />}
          </button>
        ))}
      </div>
      <button type="button" className="cc-panel-foot" onClick={onOpenAll}>
        Open {channel.label} inbox →
      </button>
    </div>
  );
}

export default function ChatChannels() {
  const admin = useSelector(selectCurrentAdmin);
  const allowed = SUPER_ADMIN_ROLES.includes(admin?.role);
  const [counts, setCounts] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const [pulse, setPulse] = useState({});
  const [inbox, setInbox] = useState({ open: false, channel: '', lead: null });
  const [report, setReport] = useState(null); // channel key
  const timer = useRef(null);

  const loadCounts = useCallback(async () => {
    const res = await request.get({ entity: 'facebook/chats?limit=300' });
    if (!res?.success) return;
    const by = res.result.byChannel;
    if (by) return setCounts(by);
    // older backend without byChannel — count from the rows
    const c = { messenger: { unread: 0 }, whatsapp: { unread: 0 }, instagram: { unread: 0 } };
    res.result.rows.forEach((r) => r.unread && c[r.chatChannel] && (c[r.chatChannel].unread += 1));
    setCounts(c);
  }, []);

  useEffect(() => {
    if (!allowed) return undefined;
    loadCounts();
    const iv = setInterval(loadCounts, 120000); // safety net if the socket drops
    let s = null;
    const on = (p) => {
      if (p?.channel && p.kind !== 'sent') {
        setPulse((x) => ({ ...x, [p.channel]: Date.now() }));
        setTimeout(() => setPulse((x) => ({ ...x, [p.channel]: 0 })), 2400);
      }
      clearTimeout(timer.current);
      timer.current = setTimeout(loadCounts, 500);
    };
    // the socket may not exist yet right after login — retry briefly
    const attach = () => {
      s = getSocket();
      if (s) s.on('lead:chat', on);
      return !!s;
    };
    let tries = 0;
    const retry = attach()
      ? null
      : setInterval(() => {
          tries += 1;
          if (attach() || tries > 20) clearInterval(retry);
        }, 3000);
    return () => {
      clearInterval(iv);
      if (retry) clearInterval(retry);
      clearTimeout(timer.current);
      s?.off('lead:chat', on);
    };
  }, [allowed, loadCounts]);

  // Sidebar › Sales › Ad Chats opens the same inbox (NavigationContainer).
  useEffect(() => {
    if (!allowed) return undefined;
    const open = () => {
      setOpenKey(null);
      setInbox({ open: true, channel: 'whatsapp', lead: null });
    };
    window.addEventListener('clc:open-ad-chats', open);
    return () => window.removeEventListener('clc:open-ad-chats', open);
  }, [allowed]);

  if (!allowed) return null;

  const openInbox = (channel, lead) => {
    setOpenKey(null);
    setInbox({ open: true, channel, lead: lead || null });
  };

  return (
    <>
      <div className="cc-group" role="group" aria-label="Ad chats">
        {CHANNELS.map((ch) => {
          const n = counts?.[ch.key]?.unread || 0;
          return (
            <Popover
              key={ch.key}
              trigger="click"
              placement="bottomRight"
              arrow={false}
              open={openKey === ch.key}
              onOpenChange={(v) => setOpenKey(v ? ch.key : null)}
              overlayClassName="cc-popover"
              destroyTooltipOnHide
              content={<ChannelPanel channel={ch} onOpenChat={(r) => openInbox(ch.key, r)} onOpenAll={() => openInbox(ch.key)} onOpenReport={() => { setOpenKey(null); setReport(ch.key); }} />}
            >
              <button
                type="button"
                className={`cc-btn cc-${ch.key} ${n ? 'has-unread' : ''} ${pulse[ch.key] ? 'is-pulsing' : ''} ${openKey === ch.key ? 'is-open' : ''}`}
                aria-label={`${ch.label} chats${n ? `, ${n} unread` : ''}`}
                title={`${ch.label} chats`}
              >
                <ch.Icon />
                {n > 0 && <span className="cc-badge">{n > 99 ? '99+' : n}</span>}
              </button>
            </Popover>
          );
        })}
      </div>
      <AdChatInbox
        open={inbox.open}
        initialChannel={inbox.channel}
        initialLead={inbox.lead}
        onClose={() => {
          setInbox({ open: false, channel: '', lead: null });
          loadCounts();
        }}
      />
      {report && (
        <ChatStatsModal
          open
          channel={report}
          label={(CHANNELS.find((c) => c.key === report) || {}).label || 'Chats'}
          onClose={() => setReport(null)}
        />
      )}
    </>
  );
}
