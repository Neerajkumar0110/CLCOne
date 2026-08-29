import React, { createContext, useContext, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { useSocket } from "@/context/socketContext";
import { request } from "@/request";
import { playNotificationSound } from "@/utils/notificationSound";

// App-wide event notifications (Leads/Tickets/Invoices/Payments/User
// Management — see backend/src/notify.js) — distinct from messagesContext,
// which is specifically Team Chat DMs. NotificationBell merges both into
// one feed.
const NotificationsContext = createContext(null);

export function NotificationsProvider({ children }) {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const { socket } = useSocket();
  const [notifications, setNotifications] = useState([]);

  const refreshNotifications = async () => {
    const res = await request.get({ entity: "notification/mine" });
    if (res?.success) setNotifications(res.result);
  };

  useEffect(() => {
    if (currentAdmin?._id) refreshNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAdmin?._id]);

  useEffect(() => {
    if (!socket) return undefined;
    const onNotification = (notification) => {
      setNotifications((prev) => [notification, ...prev]);
      playNotificationSound();
    };
    socket.on("notification:new", onNotification);
    return () => socket.off("notification:new", onNotification);
  }, [socket]);

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
