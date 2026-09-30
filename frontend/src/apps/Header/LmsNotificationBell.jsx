import { useState } from 'react';
import { Badge, Popover } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { initials, colorForName } from '@/utils/adminDisplay';

// Same time-ago formatting as the Admin bell (apps/Header/NotificationBell.jsx) —
// kept as a plain duplicate rather than a shared import since that file lives
// under the CRM's own header, not a generic utils module.
function timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

// The LMS notify() calls (jobs/lmsLiveTick.js, lmsController/*) use a
// dotted `type` like "lms.assignment.evaluated" or "live.recording" — no
// separate human category field comes back from the API, so this buckets
// the prefix into the same kind of short label the Admin bell shows via
// n.module (e.g. "Sales", "LMS").
function categoryLabel(type) {
  const t = String(type || '');
  if (t.startsWith('live.')) return 'Live Class';
  if (t.startsWith('lms.assignment')) return 'Assignment';
  if (t.startsWith('lms.doubt')) return 'Doubt';
  if (t.startsWith('lms.announcement')) return 'Announcement';
  if (t.startsWith('lms.project')) return 'Project';
  if (t.startsWith('lms.quiz')) return 'Quiz';
  if (t.startsWith('lms.policy')) return 'Policy';
  return 'LMS';
}

function NotificationRow({ item }) {
  return (
    <div onClick={item.onClick} className={`hub-notification-row${item.unseen ? ' unseen' : ''}`}>
      <div
        className="hub-avatar"
        style={{ background: colorForName(item.avatarName), width: 38, height: 38, fontSize: 14, flexShrink: 0 }}
      >
        {initials(item.avatarName)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: item.unseen ? 700 : 600, color: item.unseen ? '#101828' : '#667085' }}>
          {item.title}
        </div>
        {item.subtitle && (
          <div
            style={{
              fontSize: 12.5,
              color: item.unseen ? '#344054' : '#98a2b3',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {item.subtitle}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#98a2b3', marginTop: 2 }}>
          {timeAgo(item.time)} · {item.category}
        </div>
      </div>
      {item.unseen && (
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb', flexShrink: 0, marginTop: 6 }} />
      )}
    </div>
  );
}

function NotificationPanel({ notifications, onOpenItem, onMarkAllRead, closePopover }) {
  const [tab, setTab] = useState('inbox');

  const items = notifications.map((n) => ({
    key: n.id,
    unseen: !n.read,
    avatarName: n.actorName || categoryLabel(n.type),
    title: n.title,
    subtitle: n.body,
    category: categoryLabel(n.type),
    time: n.at,
    onClick: () => {
      closePopover();
      onOpenItem(n);
    },
  }));

  const unseenCount = items.filter((i) => i.unseen).length;
  const list = tab === 'inbox' ? items.filter((i) => i.unseen) : items;

  return (
    <div style={{ width: 340, maxHeight: 480, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 15 }}>Notifications</strong>
        <button
          type="button"
          className="hub-link-btn"
          style={{ fontSize: 12, opacity: unseenCount === 0 ? 0.4 : 1 }}
          disabled={unseenCount === 0}
          onClick={onMarkAllRead}
        >
          Mark all as read
        </button>
      </div>

      <div style={{ padding: '4px 12px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
        <button type="button" className={`hub-notif-tab${tab === 'inbox' ? ' active' : ''}`} onClick={() => setTab('inbox')}>
          Inbox {unseenCount > 0 && <span className="hub-notif-tab-count">{unseenCount}</span>}
        </button>
        <button type="button" className={`hub-notif-tab${tab === 'general' ? ' active' : ''}`} onClick={() => setTab('general')}>
          General
        </button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '0 8px 8px' }}>
        {list.length === 0 ? (
          <div className="hub-empty" style={{ padding: '24px 8px' }}>
            {tab === 'inbox' ? "You're all caught up." : 'No notifications yet.'}
          </div>
        ) : (
          list.map((item) => <NotificationRow key={item.key} item={item} />)
        )}
      </div>
    </div>
  );
}

// Instructor/Candidate panel's notification bell — same look as the Admin
// header's bell (apps/Header/NotificationBell.jsx: avatar-style rows,
// unseen dot, "time ago · category", Inbox/General tabs, Mark all as read),
// just fed by this panel's own data source (lmsApi.updates(), already
// polled/socket-driven by LmsPanelApp) instead of the CRM's
// notificationsContext/messagesContext, which this panel doesn't have.
export default function LmsNotificationBell({ notifications, unread, onOpenItem, onMarkAllRead }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      overlayInnerStyle={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}
      content={
        <NotificationPanel
          notifications={notifications}
          onOpenItem={onOpenItem}
          onMarkAllRead={onMarkAllRead}
          closePopover={() => setOpen(false)}
        />
      }
    >
      <div className="header-bell-trigger" title="Notifications">
        <Badge count={unread || 0} size="small" offset={[-2, 4]}>
          <BellOutlined style={{ fontSize: 20, color: 'var(--nav-text)' }} />
        </Badge>
      </div>
    </Popover>
  );
}
