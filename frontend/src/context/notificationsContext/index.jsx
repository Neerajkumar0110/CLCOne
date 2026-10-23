import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { request } from "@/request";
import { silentGet } from "@/request/silent";
import { playNotificationSound } from "@/utils/notificationSound";
import { startPoll } from "@/utils/poll";
import { getSocket } from "@/socket";
import { notification as toast } from "antd";

const ADMIN_ROLES = ["owner", "Super Admin", "Admin"];

// Open a notification's link without a full page reload (BrowserRouter
// listens for popstate).
function goTo(link) {
  if (!link) return;
  window.history.pushState({}, "", link);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// The live pop-up in the corner, on top of the bell badge.
function popUp(n, { forName } = {}) {
  if (!n?.title) return;
  toast.open({
    key: `notif-${n.type}-${n.title}-${n.body || ""}`,
    message: n.title,
    description: [n.body, forName ? `→ ${forName}` : null].filter(Boolean).join("  ·  ") || undefined,
    placement: "bottomRight",
    duration: 6,
    style: { cursor: n.link ? "pointer" : "default" },
    onClick: () => goTo(n.link),
  });
}

// Poll interval for event notifications — the "real-time" path now that the
// backend has no live socket on serverless (see context/socketContext).
// Paused while the tab is hidden (see startPoll).
const POLL_INTERVAL_MS = 20000;

// App-wide event notifications (Leads/Tickets/Invoices/Payments/User
// Management — see backend/src/notify.js) — distinct from messagesContext,
// which is specifically Team Chat DMs. NotificationBell merges both into
// one feed.
const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const [notifications, setNotifications] = useState([]);
  const isAdmin = ADMIN_ROLES.includes(currentAdmin?.role);
  // Admins: every user's notifications (GET /notification/all).
  const [allNotifications, setAllNotifications] = useState([]);
  const refreshAll = async () => {
    if (!isAdmin) return;
    const res = await silentGet("notification/all");
    if (res?.success && Array.isArray(res.result)) setAllNotifications(res.result);
  };
  // Newest notification id seen so far — lets a poll tell "genuinely new"
  // from "same list again". `null` until the first fetch so logging in
  // doesn't fire the sound for a backlog.
  const latestIdRef = useRef(null);

  const refreshNotifications = async () => {
    const res = await silentGet("notification/mine");
    if (!res?.success || !Array.isArray(res.result)) return;
    setNotifications(res.result);

    const newestId = res.result[0]?._id || null;
    if (latestIdRef.current !== null && newestId && newestId !== latestIdRef.current) {
      const hasUnread = res.result.some((n) => !n.readAt);
      if (hasUnread) playNotificationSound();
    }
    latestIdRef.current = newestId;
  };

  useEffect(() => {
    if (!currentAdmin?._id) return undefined;
    latestIdRef.current = null;
    // startPoll fires the first call itself and pauses while the tab is hidden.
    const stopPoll = startPoll(refreshNotifications, POLL_INTERVAL_MS);

    // Instant push on top of the 20s poll — a no-op on serverless (no
    // persistent socket there, see backend/src/socket.js), live on the VPS
    // process, same pattern LmsPanelApp already uses for its own bell.
    const socket = getSocket();
    const onNotification = (n) => {
      popUp(n);
      refreshNotifications();
    };
    socket?.on("notification:new", onNotification);

    // Admins: someone else's notification — show it live too.
    let allTimer = null;
    const stopAllPoll = isAdmin ? startPoll(refreshAll, 30000) : () => {};
    const onAny = (n) => {
      if (String(n?.recipient) !== String(currentAdmin._id)) popUp(n);
      clearTimeout(allTimer);
      allTimer = setTimeout(refreshAll, 800);
    };
    if (isAdmin) socket?.on("notification:any", onAny);

    return () => {
      stopPoll();
      stopAllPoll();
      clearTimeout(allTimer);
      socket?.off("notification:new", onNotification);
      socket?.off("notification:any", onAny);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAdmin?._id]);

  const markOneRead = async (id) => {
    setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    await request.patch({ entity: `notification/${id}/read`, jsonData: {} });
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    await request.patch({ entity: "notification/read-all", jsonData: {} });
  };

  const unreadNotifCount = notifications.filter((n) => !n.readAt).length;

  return (
    <NotificationsContext.Provider
      value={{ notifications, refreshNotifications, markOneRead, markAllRead, unreadNotifCount, isAdmin, allNotifications, refreshAll }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within a NotificationsProvider");
  }
  return ctx;
}
