import { useEffect, useRef, useState } from "react";
import { request } from "@/request";

// Browser phone for the Instant Lead Pool's "browser" connect mode (backend
// services/calling/connectModes.js). While the agent is in the pool and the
// mode is on, this logs into the agent's Plivo SIP endpoint in the CRM tab,
// AUTO-ANSWERS every pool call (headset), and heartbeats "ready" to the
// server every 30s — the dialer only routes customers to agents whose tab
// is ready. Off / other modes → logged out, nothing rendered.
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
  const [wanted, setWanted] = useState(false); // in pool + browser mode
  const [state, setState] = useState("off"); // off | starting | ready | oncall | error
  const [err, setErr] = useState("");
  const sdkRef = useRef(null);
  const beatRef = useRef(null);

  // Is browser mode on for me right now?
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const r = await silentGet("calling/lead-pool/status");
      if (!alive || !r?.success) return;
      setWanted(!!r.result?.on && r.result?.connectMode === "browser");
    };
    check();
    const t = setInterval(check, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

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
    (async () => {
      try {
        setState("starting");
        setErr("");
        // Ask for the mic up front so the first call doesn't stall on it.
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((st) => st.getTracks().forEach((t) => t.stop()));
        await loadSdk();
        const cr = await request.get({ entity: "calling/browser-phone/credentials" });
        if (!cr?.success) throw new Error(cr?.message || "No browser phone login");
        if (cancelled) return;
        const sdk = new window.Plivo({ debug: "ERROR", permOnClick: false, enableTracking: false, closeProtection: true });
        sdkRef.current = sdk;
        const beat = () => request.post({ entity: "calling/browser-phone/ready", jsonData: { ready: true } }).catch(() => {});
        sdk.client.on("onLogin", () => {
          setState("ready");
          beat();
          clearInterval(beatRef.current);
          beatRef.current = setInterval(beat, 30000);
        });
        sdk.client.on("onLoginFailed", (cause) => {
          setState("error");
          setErr(`Phone login failed${cause ? `: ${cause}` : ""}`);
        });
        sdk.client.on("onIncomingCall", (callerName, extraHeaders, callInfo) => {
          // Pool calls only reach this endpoint — pick up at once.
          try {
            sdk.client.answer(callInfo && callInfo.callUUID, "reject");
          } catch {
            sdk.client.answer();
          }
        });
        sdk.client.on("onCallAnswered", () => setState("oncall"));
        sdk.client.on("onCallTerminated", () => setState("ready"));
        sdk.client.on("onCallFailed", () => setState("ready"));
        sdk.client.on("onLogout", () => setState("off"));
        sdk.client.login(cr.result.username, cr.result.password);
      } catch (e) {
        if (cancelled) return;
        setState("error");
        setErr(e?.name === "NotAllowedError" ? "Microphone blocked — allow it in the browser to take calls." : e?.message || "Phone error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  if (state === "off") return null;
  const color = { starting: "#d97706", ready: "#16a34a", oncall: "#2563eb", error: "#dc2626" }[state];
  const text = {
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
        boxShadow: "0 4px 14px rgba(0,0,0,.12)", maxWidth: 420,
      }}
    >
      {text}
    </div>
  );
}
