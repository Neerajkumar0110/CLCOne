import { useEffect, useRef, useState } from "react";

// One CRM tab owns the phone (BrowserPhone + in-call popup + instant-lead
// alert) so a call never rings — or pops up — in two tabs at once. The tab
// that was open first keeps it (a live call is never taken away); when that
// tab closes or goes quiet, another open tab takes over within a few seconds.
// Used by the CRM (ErpApp) and Sales One Place (/sales-v3).
const KEY = "clc-phone-tab";
const BEAT_MS = 2000;
// Long enough for a background tab whose timers the browser slows to ~1/min.
const STALE_MS = 90000;

const read = () => {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "null");
  } catch (e) {
    return null;
  }
};
const write = (v) => {
  try {
    if (v) window.localStorage.setItem(KEY, JSON.stringify(v));
    else window.localStorage.removeItem(KEY);
  } catch (e) {
    /* storage blocked: every tab acts alone, as before */
  }
};

export default function usePhoneTab() {
  const id = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [owner, setOwner] = useState(() => {
    const cur = read();
    return !cur || Date.now() - cur.at > STALE_MS;
  });

  useEffect(() => {
    const me = id.current;
    const tick = () => {
      const cur = read();
      const free = !cur || cur.id === me || Date.now() - cur.at > STALE_MS;
      if (free) write({ id: me, at: Date.now() });
      setOwner(free);
    };
    tick();
    const t = setInterval(tick, BEAT_MS);
    const onStorage = (e) => {
      if (e.key === KEY) {
        const cur = read();
        if (cur && cur.id !== me && Date.now() - cur.at <= STALE_MS) setOwner(false);
      }
    };
    const release = () => {
      const cur = read();
      if (cur && cur.id === me) write(null);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("beforeunload", release);
    return () => {
      clearInterval(t);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", release);
      release();
    };
  }, []);

  return owner;
}
