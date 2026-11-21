import React, { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { prettyNumber } from './ChatThread';
import { ChatAvatar } from './ui';

const TAG_COLORS = ['#1d4ed8', '#7c3aed', '#0f766e', '#b45309', '#be185d', '#475569'];
const tagColor = (id) => {
  const s = String(id || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
};

const when = (d) => {
  if (!d) return '';
  const t = dayjs(d);
  if (t.isSame(dayjs(), 'day')) return t.format('h:mm A');
  if (t.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday';
  if (t.isAfter(dayjs().subtract(6, 'day'))) return t.format('ddd');
  return t.format('D MMM');
};

// Row menu (WhatsApp's chevron on hover): Mark as read / Mark as unread.
function RowMenu({ chat, onToggleRead }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const unread = chat.unread > 0;
  return (
    <div className={`wa-row-menu ${open ? 'open' : ''}`} ref={ref}>
      <button type="button" className="wa-row-chev" aria-label="Chat options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="wa-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onToggleRead(chat, !unread);
            }}
          >
            {unread ? 'Mark as read' : 'Mark as unread'}
          </button>
        </div>
      )}
    </div>
  );
}

// Conversation list. showOwner = Live Chats by department (tag who handles it).
// onToggleRead(chat, makeUnread) — when given, each row gets the read / unread menu.
export default function ChatList({ chats, activeId, onPick, onToggleRead, showOwner = false, empty = 'No chats yet.' }) {
  if (!chats.length) return <div className="wa-empty">{empty}</div>;
  return (
    <div className="wa-list">
      {chats.map((c) => {
        const active = String(activeId) === String(c._id);
        const unread = c.unread > 0;
        return (
          <div key={c._id} className={`wa-list-row ${unread ? 'is-unread' : ''}`}>
            <button type="button" className={`wa-list-item ${active ? 'active' : ''}`} onClick={() => onPick(c._id)} aria-pressed={active}>
              <ChatAvatar chat={c} />
              <div className="wa-list-main">
                <div className="wa-list-top">
                  <span className="wa-list-name">{c.customerName || prettyNumber(c.customerNumber)}</span>
                  <span className="wa-list-time">{when(c.lastMessageAt || c.createdAt)}</span>
                </div>
                <div className="wa-list-bottom">
                  <span className="wa-list-last">
                    {c.lastDirection === 'outgoing' ? 'You: ' : ''}
                    {c.lastMessage || 'No messages yet'}
                  </span>
                  {unread && (
                    <span className="wa-unread" aria-label={`${c.unread} unread`}>
                      {c.unread > 99 ? '99+' : c.unread}
                    </span>
                  )}
                </div>
                {showOwner && c.userName && (
                  <span className="wa-owner-tag" style={{ background: tagColor(c.userId) }}>
                    by {c.userName}
                  </span>
                )}
              </div>
            </button>
            {onToggleRead && <RowMenu chat={c} onToggleRead={onToggleRead} />}
          </div>
        );
      })}
    </div>
  );
}
