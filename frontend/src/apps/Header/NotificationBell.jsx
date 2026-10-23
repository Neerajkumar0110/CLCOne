import { useNavigate } from "react-router-dom";
import { useMessages } from "@/context/messagesContext";
import { useNotifications } from "@/context/notificationsContext";
import { displayName } from "@/utils/adminDisplay";
import { NotificationPanelView, NotificationBellShell } from "./NotificationPanelView";

// Merges the two real notification sources this app has — Team Chat DMs
// (messagesContext) and app-wide events like new leads/tickets/invoices
// (notificationsContext, see backend/src/notify.js) — into one feed. The
// dropdown itself is the shared NotificationPanelView.
function CrmNotificationPanel({ navigate, closePopover }) {
  const { conversations, markAllRead: markMessagesRead } = useMessages();
  const { notifications, markOneRead, markAllRead: markNotificationsRead, isAdmin, allNotifications } = useNotifications();

  const everyoneItems = isAdmin
    ? allNotifications.map((n) => ({
        key: `all:${n._id}`,
        unseen: false,
        avatarName: n.actorName || n.module,
        title: n.title,
        subtitle: n.body,
        category: `${n.module} → ${n.recipients.slice(0, 2).join(", ")}${n.recipients.length > 2 ? ` +${n.recipients.length - 2}` : ""} · ${n.readCount}/${n.recipients.length} read`,
        time: n.created,
        onClick: () => {
          closePopover();
          if (n.link) navigate(n.link);
        },
      }))
    : null;

  const messageItems = conversations
    .filter((c) => c.lastMessage) // no history yet -> nothing to show as a notification
    .map((c) => {
      const name = displayName(c.user);
      const attachment = c.lastMessage.attachment;
      return {
        key: `msg:${c.user._id}`,
        unseen: c.unreadCount > 0,
        avatarName: name,
        title: name,
        subtitle: attachment ? null : c.lastMessage.text,
        attachmentName: attachment?.fileName,
        category: attachment ? "Attached file" : "New message",
        time: c.lastMessage.created,
        onClick: () => {
          closePopover();
          navigate(`/messenger/chat?dm=${c.user._id}`); // Team Chat — open to every user
        },
      };
    });

  const notificationItems = notifications.map((n) => ({
    key: `notif:${n._id}`,
    unseen: !n.readAt,
    avatarName: n.actorName || n.module,
    title: n.title,
    subtitle: n.body,
    category: n.module,
    time: n.created,
    onClick: () => {
      closePopover();
      if (!n.readAt) markOneRead(n._id);
      if (n.link) navigate(n.link);
    },
  }));

  return (
    <NotificationPanelView
      items={[...messageItems, ...notificationItems]}
      everyoneItems={everyoneItems}
      onMarkAllRead={() => {
        markMessagesRead();
        markNotificationsRead();
      }}
    />
  );
}

// Header-wide notification bell — a dropdown anchored to the bell icon (not
// a modal). Backed by messagesContext + notificationsContext, so the
// sidebar's Communication badge, Team Chat, and every module's real-time
// events all funnel into this one feed.
export default function NotificationBell() {
  const navigate = useNavigate();
  const { totalUnread: unreadMessages } = useMessages();
  const { unreadNotifCount } = useNotifications();

  return (
    <NotificationBellShell
      count={unreadMessages + unreadNotifCount}
      iconColor="#cbd5e1"
      renderPanel={(close) => <CrmNotificationPanel navigate={navigate} closePopover={close} />}
    />
  );
}
