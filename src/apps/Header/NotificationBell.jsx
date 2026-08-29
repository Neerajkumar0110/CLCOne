import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Popover } from "antd";
import { BellOutlined, PaperClipOutlined, SettingOutlined } from "@ant-design/icons";
import { useMessages } from "@/context/messagesContext";
import { useNotifications } from "@/context/notificationsContext";
import { initials, colorForName, displayName } from "@/utils/adminDisplay";

function timeAgo(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

function NotificationRow({ item }) {
  return (
    <div onClick={item.onClick} className={`hub-notification-row${item.unseen ? " unseen" : ""}`}>
      <div
        className="hub-avatar"
        style={{ background: colorForName(item.avatarName), width: 38, height: 38, fontSize: 14, flexShrink: 0 }}
      >
        {initials(item.avatarName)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: item.unseen ? 700 : 600, color: item.unseen ? "#101828" : "#667085" }}>
          {item.title}
        </div>
        {item.subtitle && (
          <div
            style={{
              fontSize: 12.5,
              color: item.unseen ? "#344054" : "#98a2b3",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.subtitle}
          </div>
        )}
        <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 2 }}>
          {timeAgo(item.time)} · {item.category}
        </div>
        {item.attachmentName && (
          <div style={{ fontSize: 11.5, color: "#475467", marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
            <PaperClipOutlined /> {item.attachmentName}
          </div>
        )}
      </div>
      {item.unseen && (
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb", flexShrink: 0, marginTop: 6 }} />
      )}
    </div>
  );
}

// Merges the two real notification sources this app has — Team Chat DMs
// (messagesContext) and app-wide events like new leads/tickets/invoices
// (notificationsContext, see backend/src/notify.js) — into one feed sorted
// by recency. Inbox = unseen only; General = everything, for browsing.
function NotificationPanel({ navigate, closePopover }) {
  const { conversations, markAllRead: markMessagesRead } = useMessages();
  const { notifications, markOneRead, markAllRead: markNotificationsRead } = useNotifications();
  const [tab, setTab] = useState("inbox");

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
          navigate(`/communication?dm=${c.user._id}`);
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

  const merged = [...messageItems, ...notificationItems].sort((a, b) => new Date(b.time) - new Date(a.time));
  const unseenCount = merged.filter((i) => i.unseen).length;
  const list = tab === "inbox" ? merged.filter((i) => i.unseen) : merged;

  const markAllRead = () => {
    markMessagesRead();
    markNotificationsRead();
  };

  return (
    <div style={{ width: 340, maxHeight: 480, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 16px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 15 }}>Notifications</strong>
        <button
          type="button"
          className="hub-link-btn"
          style={{ fontSize: 12, opacity: unseenCount === 0 ? 0.4 : 1 }}
          disabled={unseenCount === 0}
          onClick={markAllRead}
        >
          Mark all as read
        </button>
      </div>

      <div style={{ padding: "4px 12px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" className={`hub-notif-tab${tab === "inbox" ? " active" : ""}`} onClick={() => setTab("inbox")}>
            Inbox {unseenCount > 0 && <span className="hub-notif-tab-count">{unseenCount}</span>}
          </button>
          <button type="button" className={`hub-notif-tab${tab === "general" ? " active" : ""}`} onClick={() => setTab("general")}>
            General
          </button>
        </div>
        <SettingOutlined style={{ color: "#98a2b3" }} />
      </div>

      <div style={{ overflowY: "auto", flex: 1, padding: "0 8px 8px" }}>
        {list.length === 0 ? (
          <div className="hub-empty" style={{ padding: "24px 8px" }}>
            {tab === "inbox" ? "You're all caught up." : "No notifications yet."}
          </div>
        ) : (
          list.map((item) => <NotificationRow key={item.key} item={item} />)
        )}
      </div>
    </div>
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
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      overlayInnerStyle={{ padding: 0, borderRadius: 14, overflow: "hidden" }}
      content={<NotificationPanel navigate={navigate} closePopover={() => setOpen(false)} />}
    >
      <div className="header-bell-trigger" title="Notifications">
        <Badge count={unreadMessages + unreadNotifCount} size="small" offset={[-2, 4]}>
          <BellOutlined style={{ fontSize: 20, color: "#cbd5e1" }} />
        </Badge>
      </div>
    </Popover>
  );
}
