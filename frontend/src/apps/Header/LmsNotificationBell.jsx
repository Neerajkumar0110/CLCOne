import { NotificationPanelView, NotificationBellShell } from './NotificationPanelView';

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

// Project Manager / Candidate panel's notification bell — the exact same
// dropdown as the Admin header (shared NotificationPanelView), just fed by
// this panel's own data source (lmsApi.updates(), already polled/socket-
// driven by LmsPanelApp) instead of the CRM's notificationsContext/
// messagesContext, which this panel doesn't have.
export default function LmsNotificationBell({ notifications, unread, onOpenItem, onMarkAllRead }) {
  return (
    <NotificationBellShell
      count={unread}
      iconColor="var(--nav-text)"
      renderPanel={(close) => (
        <NotificationPanelView
          items={notifications.map((n) => ({
            key: n.id,
            unseen: !n.read,
            avatarName: n.actorName || categoryLabel(n.type),
            title: n.title,
            subtitle: n.body,
            category: categoryLabel(n.type),
            time: n.at,
            onClick: () => {
              close();
              onOpenItem(n);
            },
          }))}
          onMarkAllRead={onMarkAllRead}
        />
      )}
    />
  );
}
