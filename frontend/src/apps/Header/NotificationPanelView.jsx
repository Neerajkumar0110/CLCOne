import { useState } from "react";
import { Badge, Popover } from "antd";
import { BellOutlined, PaperClipOutlined, SettingOutlined } from "@ant-design/icons";
import { initials, colorForName } from "@/utils/adminDisplay";

// The one notification dropdown design shared by every panel — the CRM
// header (NotificationBell.jsx) and the Project Manager / Candidate panels
// (LmsNotificationBell.jsx). Each bell only maps its own data source into
// `items`; the look (avatar rows, unseen dot, "time ago · category",
// Inbox/General tabs, Mark all as read, settings icon) lives here only, so
// the two can never drift apart again.
//
// item: { key, unseen, avatarName, title, subtitle?, attachmentName?,
//         category, time, onClick }

export function timeAgo(iso) {
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

// Inbox = unseen only; General = everything, for browsing.
// `everyoneItems` (admins only) adds an "All users" tab: every user's
// notifications, live.
export function NotificationPanelView({ items, onMarkAllRead, everyoneItems = null }) {
  const [tab, setTab] = useState("inbox");
  const sorted = [...items].sort((a, b) => new Date(b.time) - new Date(a.time));
  const unseenCount = sorted.filter((i) => i.unseen).length;
  const list = tab === "everyone" ? everyoneItems || [] : tab === "inbox" ? sorted.filter((i) => i.unseen) : sorted;

  return (
    <div style={{ width: "min(360px, calc(100vw - 32px))", maxHeight: 480, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 16px 6px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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

      <div style={{ padding: "4px 12px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" className={`hub-notif-tab${tab === "inbox" ? " active" : ""}`} onClick={() => setTab("inbox")}>
            Inbox {unseenCount > 0 && <span className="hub-notif-tab-count">{unseenCount}</span>}
          </button>
          <button type="button" className={`hub-notif-tab${tab === "general" ? " active" : ""}`} onClick={() => setTab("general")}>
            General
          </button>
          {everyoneItems && (
            <button type="button" className={`hub-notif-tab${tab === "everyone" ? " active" : ""}`} onClick={() => setTab("everyone")}>
              All users
            </button>
          )}
        </div>
        <SettingOutlined style={{ color: "#98a2b3" }} />
      </div>

      <div style={{ overflowY: "auto", flex: 1, padding: "0 8px 8px" }}>
        {list.length === 0 ? (
          <div className="hub-empty" style={{ padding: "24px 8px" }}>
            {tab === "inbox" ? "You're all caught up." : tab === "everyone" ? "No one has any notifications yet." : "No notifications yet."}
          </div>
        ) : (
          list.map((item) => <NotificationRow key={item.key} item={item} />)
        )}
      </div>
    </div>
  );
}

// Bell icon + badge + dropdown. `renderPanel(close)` returns the panel so
// each bell can build its items with access to closing the popover.
export function NotificationBellShell({ count, iconColor, renderPanel }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      overlayInnerStyle={{ padding: 0, borderRadius: 14, overflow: "hidden" }}
      content={renderPanel(() => setOpen(false))}
    >
      <div className="header-bell-trigger" title="Notifications">
        <Badge count={count || 0} size="small" offset={[-2, 4]}>
          <BellOutlined style={{ fontSize: 20, color: iconColor }} />
        </Badge>
      </div>
    </Popover>
  );
}
