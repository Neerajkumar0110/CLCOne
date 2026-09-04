import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { selectAuth } from "@/redux/auth/selectors";
import { silentPost } from "@/request/silent";
import { startPoll } from "@/utils/poll";

// The backend runs on Vercel serverless, which can't hold a persistent
// socket.io connection, so "real-time" here is short-interval polling:
//
//   - presence  → POST /api/presence/ping every PRESENCE_INTERVAL (heartbeat
//                 + "who's online" in one call), driving `onlineIds`.
//   - messages  → messagesContext / Communication poll the REST thread +
//                 conversation list themselves.
//
// `socket` is kept in the context value as a tiny no-op event emitter so the
// existing `socket.on("message:new" | "message:read" | "notification:new")`
// call-sites stay valid without a null check; those events simply never fire
// now — the pollers below are the delivery path.
const SocketContext = createContext(null);

const PRESENCE_INTERVAL_MS = 25000;

function makeNoopEmitter() {
  return { on() {}, off() {}, emit() {}, connected: false };
}

export function SocketProvider({ children }) {
  const { current } = useSelector(selectAuth);
  const token = current?.token;
  const [onlineIds, setOnlineIds] = useState(new Set());
  const emitterRef = useRef(makeNoopEmitter());

  useEffect(() => {
    if (!token) {
      setOnlineIds(new Set());
      return undefined;
    }

    let cancelled = false;

    // silentPost (not the `request` helper) so a failed heartbeat doesn't
    // pop request.js's error toast every interval — a missed beat is
    // silent and the next tick recovers.
    const ping = async () => {
      const data = await silentPost("presence/ping");
      if (!cancelled && data?.success && Array.isArray(data.result?.onlineIds)) {
        setOnlineIds(new Set(data.result.onlineIds));
      }
    };

    // startPoll fires ping() now, then every interval, and pauses entirely
    // while the tab is hidden (re-pinging the moment it's visible again) —
    // so a backgrounded tab sends no heartbeat traffic at all.
    const stop = startPoll(ping, PRESENCE_INTERVAL_MS);

    return () => {
      cancelled = true;
      stop();
      setOnlineIds(new Set());
    };
  }, [token]);

  return (
    <SocketContext.Provider value={{ socket: emitterRef.current, onlineIds }}>
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
