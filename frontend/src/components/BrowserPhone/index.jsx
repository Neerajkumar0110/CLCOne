import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { request } from "@/request";
import { selectCurrentAdmin } from "@/redux/auth/selectors";

// Same list as backend config/roles.js NON_SALES_ROLES — they never call.
const NON_CALLING_ROLES = ["Support", "Finance", "Teacher", "Student"];

// Browser phone for the "browser" connect mode (backend services/calling/
// connectModes.js). While the mode is on, every calling user's CRM tab logs
// into their Plivo SIP endpoint, AUTO-ANSWERS their calls (pool, Dialer,
// callbacks, Facebook leads — headset), and heartbeats "ready" every 30s;
// a user whose tab isn't ready gets their mobile rung instead. Other modes
// → logged out, nothing rendered.
const SDK_URL = "https://cdn.plivo.com/sdk/browser/v2/plivo.min.js";

function loadSdk() {
  if (window.Plivo) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the Plivo phone SDK"));
    document.head.appendChild(s);
  });
}

const silentGet = async (entity) => {
  try {
    return await request.get({ entity });
  } catch {
    return null;
  }
};

export default function BrowserPhone() {
  const me = useSelector(selectCurrentAdmin);
  const canCall = !!me && !NON_CALLING_ROLES.includes(me.role);
  const [wanted, setWanted] = useState(false); // browser mode on (any calling user)
  const [state, setState] = useState("off"); // off | starting | ready | oncall | error
  const [err, setErr] = useState("");
  const sdkRef = useRef(null);
  const beatRef = useRef(null);
  // Bumped to throw the SDK away and build a fresh one — the server asks for
  // it after a call this phone didn't pick up (a stuck SDK answers "Busy").
  const [gen, setGen] = useState(0);
  const resettingRef = useRef(false);

  // Is browser mode on for me right now?
  useEffect(() => {
    if (!canCall) return undefined;
    let alive = true;
    const check = async () => {
      const r = await silentGet("calling/lead-pool/status");
      if (!alive || !r?.success) return;
      setWanted(r.result?.connectMode === "browser");
    };
    check();
    const t = setInterval(check, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [canCall]);

  useEffect(() => {
    if (!wanted) {
      if (sdkRef.current) {
        try {
          sdkRef.current.client.logout();
        } catch {
          /* already out */
        }
        sdkRef.current = null;
        request.post({ entity: "calling/browser-phone/ready", jsonData: { ready: false } }).catch(() => {});
      }
      clearInterval(beatRef.current);
      setState("off");
      return undefined;
    }

    let cancelled = false;
    // ONE tab per user runs the phone. Every open CRM tab used to log into
    // the same SIP endpoint, so Plivo sent the call to whichever registered
    // last — often a background tab Chrome had put to sleep — which rejected
    // it in 1–2 s while the other tabs kept telling the server "ready".
    // The Web Lock passes to another tab when this one closes.
    let releaseLock = () => {};
    const held = new Promise((r) => {
      releaseLock = r;
    });
    const start = async () => {
      try {
        setState("starting");
        setErr("");
        // Ask for the mic up front so the first call doesn't stall on it.
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((st) => st.getTracks().forEach((t) => t.stop()));
        await loadSdk();
        const cr = await request.get({ entity: "calling/browser-phone/credentials" });
        if (!cr?.success) throw new Error(cr?.message || "No browser phone login");
        if (cancelled) return;
        // permOnClick: true → answer() asks for AUDIO ONLY. With false the SDK
        // answered with its default constraints (audio + video), which fails
        // on a laptop without a usable camera — the call just rang out
        // ("No Answer") even though the phone was registered.
        const sdk = new window.Plivo({ debug: "ERROR", permOnClick: true, enableTracking: false, closeProtection: true, audioConstraints: true });
        sdkRef.current = sdk;
        const rebuild = () => {
          if (resettingRef.current) return;
          resettingRef.current = true;
          clearInterval(beatRef.current);
          try {
            sdk.client.hangup();
          } catch {
            /* no call */
          }
          try {
            sdk.client.logout();
          } catch {
            /* already out */
          }
          sdkRef.current = null;
          setGen((g) => g + 1);
        };
        // "Ready" only while the phone is really registered with Plivo. The
        // heartbeat used to fire on a timer no matter what, so after a Wi-Fi
        // blip / laptop sleep dropped the registration the server still
        // routed customers here and Plivo rejected them at once (nobody
        // registered). Not registered → rebuild the phone instead.
        const beat = () => {
          if (sdk.client.isLoggedIn === false) {
            report("not-registered", "rebuilding phone");
            rebuild();
            return Promise.resolve();
          }
          return request
            .post({ entity: "calling/browser-phone/ready", jsonData: { ready: true } })
            .then((r) => {
              if (r?.result?.reset) rebuild();
            })
            .catch(() => {});
        };
        // Every phone event goes to the server log, so a call that didn't
        // pick up can be traced (VPS: pm2 logs → [browser-phone]).
        const report = (event, detail) =>
          request
            .post({ entity: "calling/browser-phone/ready", jsonData: { ready: true, event, detail: String(detail || "").slice(0, 300) } })
            .catch(() => {});
        sdk.client.on("onLogin", () => {
          setState("ready");
          if (resettingRef.current) {
            resettingRef.current = false;
            report("reset-done");
          } else beat();
          clearInterval(beatRef.current);
          beatRef.current = setInterval(beat, 30000);
        });
        sdk.client.on("onLoginFailed", (cause) => {
          setState("error");
          setErr(`Phone login failed${cause ? `: ${cause}` : ""}`);
        });
        sdk.client.on("onIncomingCall", (callerName, extraHeaders, callInfo) => {
          // Only CRM calls reach this endpoint — pick up at once.
          const uuid = callInfo && callInfo.callUUID;
          report("incoming", uuid);
          let ok = false;
          try {
            ok = sdk.client.answer(uuid, "reject");
          } catch (e) {
            report("answer-error", e && e.message);
          }
          if (!ok) {
            try {
              ok = sdk.client.answer();
            } catch (e) {
              report("answer-error-2", e && e.message);
            }
          }
          report(ok ? "answer-sent" : "answer-refused", uuid);
        });
        sdk.client.on("onIncomingCallCanceled", (info) => report("incoming-canceled", info && (info.reason || JSON.stringify(info))));
        sdk.client.on("onMediaPermission", (ev) => report("media-permission", ev && JSON.stringify(ev)));
        sdk.client.on("onCallAnswered", () => {
          setState("oncall");
          report("answered");
        });
        sdk.client.on("onCallTerminated", () => setState("ready"));
        sdk.client.on("onCallFailed", (cause) => {
          setState("ready");
          report("call-failed", cause);
        });
        sdk.client.on("onLogout", () => setState("off"));
        // Connection to Plivo lost → stop saying "ready" right away.
        sdk.client.on("onConnectionChange", (info) => {
          const s = info && (info.state || info);
          if (s === "disconnected" || s === "failed") {
            report("connection", s);
            request.post({ entity: "calling/browser-phone/ready", jsonData: { ready: false } }).catch(() => {});
          }
        });
        sdk.client.login(cr.result.username, cr.result.password);
      } catch (e) {
        if (cancelled) return;
        setState("error");
        setErr(e?.name === "NotAllowedError" ? "Microphone blocked — allow it in the browser to take calls." : e?.message || "Phone error");
      }
    };
    if (navigator.locks && navigator.locks.request) {
      setState("other-tab");
      navigator.locks
        .request("clc-browser-phone", () => {
          if (cancelled) return null;
          start();
          return held;
        })
        .catch(() => {});
    } else start();
    return () => {
      cancelled = true;
      releaseLock();
    };
  }, [wanted, gen]);

  if (state === "off") return null;
  const color = { starting: "#d97706", ready: "#16a34a", oncall: "#2563eb", error: "#dc2626", "other-tab": "#64748b" }[state];
  const text = {
    "other-tab": "🎧 Browser phone is on in your other CRM tab",
    starting: "Browser phone: starting…",
    ready: "🎧 Browser phone ready",
    oncall: "🎧 On a call",
    error: err || "Browser phone error",
  }[state];
  return (
    <div
      style={{
        position: "fixed", left: 16, bottom: 16, zIndex: 1100, background: "#fff", color,
        border: `1px solid ${color}`, borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 700,
        boxShadow: "0 4px 14px rgba(0,0,0,.12)", maxWidth: "min(420px, calc(100vw - 32px))",
      }}
    >
      {text}
    </div>
  );
}
