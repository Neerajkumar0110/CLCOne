import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { request } from "@/request";
import { silentGet } from "@/request/silent";
import { playNotificationSound } from "@/utils/notificationSound";

// How often the conversation list (previews + unread badges) is re-fetched.
// This is the DM "real-time" path now that the backend has no live socket
// (Vercel serverless) — see context/socketContext.
const POLL_INTERVAL_MS = 4000;

// Single source of truth for "who's in my directory, and how many unread
// messages from each" — shared by the sidebar's Communication badge, the
// header's notification bell, and the Team Chat page itself, so all three
// always agree instead of each keeping its own copy.
const MessagesContext = createContext(null);

export function MessagesProvider({ children }) {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const [conversations, setConversations] = useState([]);
  // Whichever conversation Team Chat currently has open on screen (set via
  // setActiveConversationId) — a message arriving for that one shouldn't
  // bump its unread badge, since the user is already looking at it.
  const [activeConversationId, setActiveConversationId] = useState(null);

  // Baseline unread total for the sound trigger — `null` until the first
  // fetch lands, so logging in with existing unread messages doesn't blast
  // the notification sound.
  const prevUnreadRef = useRef(null);
  // Kept in a ref so the polling interval always sees the current open
  // thread without needing to re-create the interval on every switch.
  const activeConversationIdRef = useRef(null);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const refreshConversations = async () => {
    const res = await silentGet("message/conversations");
    if (!res?.success) return;
    setConversations(res.result);

    // Play the incoming-message sound when the unread total climbs — but
    // not for a thread that's currently open on screen, and not on the
    // very first load.
    const openId = activeConversationIdRef.current;
    const countableUnread = res.result.reduce(
      (sum, c) => sum + (c.user._id === openId ? 0 : c.unreadCount),
      0
    );
    if (prevUnreadRef.current !== null && countableUnread > prevUnreadRef.current) {
      playNotificationSound();
    }
    prevUnreadRef.current = countableUnread;
  };

  useEffect(() => {
    if (!currentAdmin?._id) return undefined;
    prevUnreadRef.current = null;
    refreshConversations();
    const id = setInterval(refreshConversations, POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAdmin?._id]);

  // Called when a thread is opened (Team Chat already marks it read
  // server-side via GET /message/thread/:userId) so the badge counts drop
  // immediately instead of waiting on the next full refresh.
  const markConversationRead = (userId) => {
    setConversations((prev) => prev.map((c) => (c.user._id === userId ? { ...c, unreadCount: 0 } : c)));
  };

  // Called right after a message is sent, so the sender's own "last
  // message" preview updates without waiting for the socket echo.
  const bumpConversationPreview = (message, otherId) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.user._id === otherId);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], lastMessage: message };
      const [item] = updated.splice(idx, 1);
      return [item, ...updated];
    });
  };

  // "Mark all as read" in the notification bell — persists server-side
  // (PATCH /message/read-all) so it survives a refresh, not just a local
  // reset of the badge counts.
  const markAllRead = async () => {
    const res = await request.patch({ entity: "message/read-all", jsonData: {} });
    if (res?.success) {
      setConversations((prev) => prev.map((c) => ({ ...c, unreadCount: 0 })));
    }
    return res;
  };

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <MessagesContext.Provider
      value={{
        conversations,
        refreshConversations,
        markConversationRead,
        bumpConversationPreview,
        markAllRead,
        totalUnread,
        setActiveConversationId,
      }}
    >
      {children}
    </MessagesContext.Provider>
  );
}

export function useMessages() {
  const ctx = useContext(MessagesContext);
  if (!ctx) {
    throw new Error("useMessages must be used within a MessagesProvider");
  }
  return ctx;
}
