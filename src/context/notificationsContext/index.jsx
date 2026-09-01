import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { request } from "@/request";
import { silentGet } from "@/request/silent";
import { playNotificationSound } from "@/utils/notificationSound";

// Poll interval for event notifications — the "real-time" path now that the
// backend has no live socket on serverless (see context/socketContext).
const POLL_INTERVAL_MS = 10000;

// App-wide event notifications (Leads/Tickets/Invoices/Payments/User
// Management — see backend/src/notify.js) — distinct from messagesContext,
// which is specifically Team Chat DMs. NotificationBell merges both into
// one feed.
const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const [notifications, setNotifications] = useState([]);
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
    refreshNotifications();
    const id = setInterval(refreshNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(id);
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
      value={{ notifications, refreshNotifications, markOneRead, markAllRead, unreadNotifCount }}
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
