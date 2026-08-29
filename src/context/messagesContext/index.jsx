import React, { createContext, useContext, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { useSocket } from "@/context/socketContext";
import { request } from "@/request";
import { playNotificationSound } from "@/utils/notificationSound";

// Single source of truth for "who's in my directory, and how many unread
// messages from each" — shared by the sidebar's Communication badge, the
// header's notification bell, and the Team Chat page itself, so all three
// always agree instead of each keeping its own copy.
const MessagesContext = createContext(null);

export function MessagesProvider({ children }) {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const { socket } = useSocket();
  const [conversations, setConversations] = useState([]);
  // Whichever conversation Team Chat currently has open on screen (set via
  // setActiveConversationId) — a message arriving for that one shouldn't
  // bump its unread badge, since the user is already looking at it.
  const [activeConversationId, setActiveConversationId] = useState(null);

  const refreshConversations = async () => {
    const res = await request.get({ entity: "message/conversations" });
    if (res?.success) setConversations(res.result);
  };

  useEffect(() => {
    if (currentAdmin?._id) refreshConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAdmin?._id]);

  // Real-time: every "message:new" push (see backend/src/socket.js) bumps
  // that person's lastMessage and, if it was sent to me, their unread count
  // — no matter which page is currently open.
  useEffect(() => {
    if (!socket || !currentAdmin) return undefined;

    const onMessage = (msg) => {
      const otherId = msg.from === currentAdmin._id ? msg.to : msg.from;
      const incoming = msg.to === currentAdmin._id;
      const isOpen = otherId === activeConversationId;
      const isNewUnread = incoming && !isOpen;

      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.user._id === otherId);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          lastMessage: msg,
          unreadCount: isNewUnread ? updated[idx].unreadCount + 1 : updated[idx].unreadCount,
        };
        const [item] = updated.splice(idx, 1);
        return [item, ...updated];
      });

      // Only for messages that actually land as a new unread notification —
      // not your own sent messages echoing back, and not one for a thread
      // you're already looking at.
      if (isNewUnread) playNotificationSound();
    };

    socket.on("message:new", onMessage);
    return () => socket.off("message:new", onMessage);
  }, [socket, currentAdmin, activeConversationId]);

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
