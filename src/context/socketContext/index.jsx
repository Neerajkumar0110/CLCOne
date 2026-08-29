import React, { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useSelector } from "react-redux";
import { selectAuth } from "@/redux/auth/selectors";
import { BASE_URL } from "@/config/serverApiConfig";

// One socket.io connection for the whole app, authenticated with the same
// JWT as the REST API (see backend/src/socket.js). Currently only Team Chat
// (pages/Communication) listens on it, but it's app-level so presence/online
// status stays accurate even when that page isn't open.
const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { current } = useSelector(selectAuth);
  const token = current?.token;
  const [socket, setSocket] = useState(null);
  const [onlineIds, setOnlineIds] = useState(new Set());

  useEffect(() => {
    if (!token) return undefined;

    const s = io(BASE_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
    });

    s.on("presence:snapshot", ({ userIds }) => setOnlineIds(new Set(userIds)));
    s.on("presence:update", ({ userId, online }) => {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        if (online) next.add(userId);
        else next.delete(userId);
        return next;
      });
    });

    setSocket(s);

    return () => {
      s.disconnect();
      setSocket(null);
      setOnlineIds(new Set());
    };
  }, [token]);

  return (
    <SocketContext.Provider value={{ socket, onlineIds }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return ctx;
}
