import { useEffect } from "react";
import { API_BASE_URL } from "@/config/serverApiConfig";
import storePersist from "@/redux/storePersist";

// What a Sales user does in the CRM, for Sales 360° › Activity log: screens
// opened, buttons clicked, search text and idle stretches (backend
// /workday/track → UserEvent). Text typed into any other field is never read.
const FLUSH_MS = 20 * 1000;
const IDLE_AFTER_MS = 5 * 60 * 1000;
const CLICKABLE = 'button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="switch"], .ant-select-item, .ant-menu-item, tr, input[type="checkbox"], input[type="radio"]';

const screenName = (path) =>
  path
    .split("/")
    .filter((x) => x && !/^[0-9a-f]{24}$/i.test(x))
    .map((x) => x.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase()))
    .join(" › ") || "Dashboard";

function labelOf(el) {
  const raw = el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.getAttribute("name") || "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 100);
}

export default function useActivityTracker(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    let queue = [];
    let stopped = false;
    let lastInput = Date.now();
    let idleSince = null;
    let path = window.location.pathname;
    const push = (e) => {
      if (!stopped) queue.push({ at: new Date().toISOString(), path: window.location.pathname, ...e });
    };

    const flush = () => {
      if (!queue.length || stopped) return;
      const events = queue.slice(0, 100);
      queue = queue.slice(100);
      const token = storePersist.get("auth")?.current?.token;
      fetch(`${API_BASE_URL}workday/track`, {
        method: "POST",
        keepalive: true,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ events }),
      })
        .then((r) => {
          if (r.status === 403) stopped = true; // not a Sales user
        })
        .catch(() => {
          queue = [...events, ...queue].slice(0, 500); // offline: try again next time
        });
    };

    const endIdle = () => {
      if (idleSince == null) return;
      push({ kind: "idle", at: new Date(idleSince).toISOString(), seconds: Math.round((Date.now() - idleSince) / 1000) });
      idleSince = null;
    };
    const touched = () => {
      lastInput = Date.now();
      endIdle();
    };
    const onClick = (e) => {
      touched();
      const el = e.target instanceof Element ? e.target.closest(CLICKABLE) : null;
      if (el) push({ kind: "click", label: labelOf(el) });
    };
    // Only a search box's text; a password or form field is never looked at.
    const onChange = (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.type === "password") return;
      if (el.type === "search" || /search/i.test(el.placeholder || "")) {
        if (el.value.trim()) push({ kind: "search", label: el.value.trim().slice(0, 100) });
      }
    };
    const onHide = () => {
      endIdle();
      flush();
    };

    push({ kind: "screen", label: screenName(path) });
    const tick = setInterval(() => {
      if (window.location.pathname !== path) {
        path = window.location.pathname;
        push({ kind: "screen", label: screenName(path) });
      }
      if (idleSince == null && Date.now() - lastInput >= IDLE_AFTER_MS) idleSince = lastInput;
    }, 1000);
    const flusher = setInterval(flush, FLUSH_MS);

    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    ["keydown", "mousemove", "wheel", "touchstart"].forEach((n) => window.addEventListener(n, touched, { passive: true }));
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(tick);
      clearInterval(flusher);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
      ["keydown", "mousemove", "wheel", "touchstart"].forEach((n) => window.removeEventListener(n, touched));
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [enabled]);
}
