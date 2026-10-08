import { useEffect, useRef, useState } from "react";
import { request } from "@/request";
import { startPoll } from "@/utils/poll";

// ── formatting ──────────────────────────────────────────────────────────
export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

// Force Asia/Kolkata explicitly rather than relying on the viewer's
// browser/OS timezone — this CRM and every caller/customer are India-based,
// so a machine with a different (or misconfigured) local timezone should
// still show the real IST wall-clock time here, not its own local time.
export function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
}
export function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" });
}

// ── status → badge class (reuses hub-badge-*) ───────────────────────────
export const CALL_STATUS_BADGE = {
  queued: "hub-badge-gray",
  dialing: "hub-badge-blue",
  ringing: "hub-badge-yellow",
  connected: "hub-badge-green",
  onhold: "hub-badge-yellow",
  "no-answer": "hub-badge-gray",
  busy: "hub-badge-yellow",
  failed: "hub-badge-red",
  voicemail: "hub-badge-gray",
  completed: "hub-badge-green",
  transferred: "hub-badge-purple",
  cancelled: "hub-badge-red",
};

export const CAMPAIGN_STATUS_BADGE = {
  Draft: "hub-badge-gray",
  Scheduled: "hub-badge-blue",
  Active: "hub-badge-green",
  Paused: "hub-badge-yellow",
  Completed: "hub-badge-purple",
  Cancelled: "hub-badge-red",
};

export const AGENT_STATUS_BADGE = {
  Offline: "hub-badge-gray",
  Available: "hub-badge-green",
  Ringing: "hub-badge-yellow",
  OnCall: "hub-badge-blue",
  Wrapup: "hub-badge-yellow",
  Paused: "hub-badge-gray",
};

export const CAMPAIGN_STATUSES = ["Draft", "Scheduled", "Active", "Paused", "Completed", "Cancelled"];
export const CAMPAIGN_TYPES = ["Outbound", "Inbound", "Blended", "Survey", "Follow-up"];
export const PRIORITIES = ["Low", "Normal", "High", "Urgent"];

// ── polling hook: calls loader() now + every intervalMs while mounted AND
// while the tab is visible (paused in the background — see utils/poll). ────
export function usePoll(loader, intervalMs, deps = []) {
  const savedLoader = useRef(loader);
  savedLoader.current = loader;
  useEffect(() => {
    return startPoll(() => savedLoader.current(), intervalMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ── one-shot provider/meta loaders ─────────────────────────────────────
export function useCallingMeta() {
  const [meta, setMeta] = useState({ dispositions: [], agents: [], teams: [], transferTargets: [], tier: "agent" });
  useEffect(() => {
    request.get({ entity: "calling/meta" }).then((r) => r?.success && setMeta(r.result));
  }, []);
  return meta;
}

// Place a call to one contact from anywhere in the calling module — the
// Dialer, a Callbacks row, a Call History row.
//
// On the cloud provider the backend rings the customer and bridges them to
// this agent, and pushes `call:ringing` over the socket, which is what pops
// components/ActiveCallModal — so the agent gets the same in-call form no
// matter which button started the call. On a device/manual setup there is
// no server leg, so hand the returned tel: URI to the phone instead.
//
// Returns the backend's message so the caller can show it; `ok` says whether
// the call actually started.
export async function dialContact({ phone, contactName, callLead, campaign } = {}) {
  if (!phone) return { ok: false, message: "This contact has no phone number." };
  const r = await request.post({
    entity: "calling/manual/dial",
    jsonData: { phone, contactName, callLead, campaign },
  });
  if (r?.success && r.result?.tel) openTel(r.result.tel);
  return { ok: !!r?.success, message: r?.message, record: r?.result?.record };
}

// Fire the device tel: handler (mobile dials; desktop opens the default
// softphone). Rendered as text elsewhere too, so a hand-dial is always
// possible when no handler is registered.
export function openTel(phoneOrUri) {
  const raw = String(phoneOrUri || "");
  const uri = raw.startsWith("tel:") ? raw : `tel:${raw.replace(/[^\d+]/g, "")}`;
  try {
    const a = document.createElement("a");
    a.href = uri;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (e) {
    window.location.href = uri;
  }
}

export function toDatetimeLocal(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
