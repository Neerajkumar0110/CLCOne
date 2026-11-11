import React from 'react';
import dayjs from 'dayjs';
import { prettyNumber } from './ChatThread';

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

// Conversation list. showOwner = Live Chats by department (tag who handles it).
export default function ChatList({ chats, activeId, onPick, showOwner = false, empty = 'No chats yet.' }) {
  if (!chats.length) return <div className="wa-empty">{empty}</div>;
  return (
    <div className="wa-list">
      {chats.map((c) => {
        const active = String(activeId) === String(c._id);
        return (
          <button type="button" key={c._id} className={`wa-list-item ${active ? 'active' : ''}`} onClick={() => onPick(c._id)} aria-pressed={active}>
            <div className="wa-list-top">
              <span className="wa-list-name">{c.customerName || prettyNumber(c.customerNumber)}</span>
              <span className="wa-list-time">{when(c.lastMessageAt || c.createdAt)}</span>
            </div>
            <div className="wa-list-bottom">
              <span className="wa-list-last">
                {c.lastDirection === 'outgoing' ? 'You: ' : ''}
                {c.lastMessage || 'No messages yet'}
              </span>
              {c.unread > 0 && <span className="wa-unread">{c.unread}</span>}
            </div>
            {showOwner && c.userName && (
              <span className="wa-owner-tag" style={{ background: tagColor(c.userId) }}>
                by {c.userName}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
