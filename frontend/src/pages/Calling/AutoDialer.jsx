import React, { useState, useEffect } from "react";
import { useSelector } from "react-redux";
import { request } from "@/request";
import { ThunderboltOutlined, PoweroffOutlined } from "@ant-design/icons";
import { CALL_STATUS_BADGE, fmtDuration, fmtDateTime, usePoll } from "./shared";
import { selectCurrentAdmin } from "@/redux/auth/selectors";

// Mirrors backend/src/config/roles.js's NON_SALES_ROLES — the Instant Lead
// Pool is Sales-only, so Support/Finance/LMS accounts never see the toggle.
const NON_SALES_ROLES = ["Support", "Finance", "Teacher", "Student"];

// Every lead the pool has already attempted, pool-wide (every agent) — the
// system-recorded response (never blank: resolveLead sets CallLead.status
// the moment a call ends) plus whatever disposition the agent picked.
function UsedLeads() {
  const [data, setData] = useState(null);
  usePoll(async () => {
    const r = await request.get({ entity: "calling/lead-pool/used-leads?items=50" });
    if (r?.success) setData(r.result);
  }, 8000, []);

  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3>Used Leads</h3>
      </div>
      <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 12 }}>
        Every lead the Instant Lead Pool has already dialed, and the response recorded for it.
      </div>
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>Contact</th><th>Response</th><th>Disposition</th><th>Agent</th><th>Last Attempt</th></tr></thead>
          <tbody>
            {(!data || data.length === 0) && <tr><td colSpan={5}><div className="hub-empty">No leads dialed yet.</div></td></tr>}
            {data && data.map((l) => (
              <tr key={l._id}>
                <td>{l.name}<div style={{ fontSize: 11, color: "#94a3b8" }}>{l.phone}</div></td>
                <td><span className={`hub-badge ${CALL_STATUS_BADGE[l.response] || "hub-badge-gray"}`}>{l.response}</span></td>
                <td>{l.disposition || "—"}</td>
                <td>{l.agentName || "—"}</td>
                <td>{l.lastAttemptAt ? fmtDateTime(l.lastAttemptAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One-click power-dialer: join and it starts dialing straight from the
// Sales pipeline's own unassigned New Leads, distributing connected calls
// across everyone currently joined (see backend leadPool.js + the
// leadPoolSyncTick job that feeds it and notifies on exhaustion).
function InstantLeadPool() {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const isSales = !NON_SALES_ROLES.includes(currentAdmin?.role);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activeCall, setActiveCall] = useState(null);
  const [now, setNow] = useState(Date.now());
  const on = !!data?.on;

  const load = async () => {
    if (!isSales) return;
    const r = await request.get({ entity: "calling/lead-pool/status" });
    if (r?.success) setData(r.result);
  };
  usePoll(load, 4000, [isSales]);

  // Live "is a call actually going out right now" indicator — same endpoint
  // the manual Dialer screen polls, so a call this agent gets fed by the
  // pool shows up here exactly like a manually-dialled one would: Ringing
  // while Plivo is calling the customer, then Connected with a live timer.
  usePoll(async () => {
    if (!isSales || !on) {
      setActiveCall(null);
      return;
    }
    const r = await request.get({ entity: "calling/agent/active" });
    setActiveCall(r?.success ? r.result : null);
  }, 2000, [isSales, on]);

  useEffect(() => {
    if (!activeCall?.call) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeCall?.call?._id, activeCall?.call?.status]);

  if (!isSales) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const r = await request.post({ entity: "calling/lead-pool/toggle", jsonData: { on: !data?.on } });
    if (!r?.success) window.alert(r?.message || "Could not change your Instant Lead Pool status.");
    await load();
    setBusy(false);
  };

  const call = activeCall?.call;
  const lead = activeCall?.lead;
  const isRinging = !!call && !call.answeredAt;
  const isConnected = !!call && !!call.answeredAt;
  const callSeconds = isConnected ? Math.max(0, Math.floor((now - new Date(call.answeredAt).getTime()) / 1000)) : 0;

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><ThunderboltOutlined /> Instant Lead Pool</h3>
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            title={on ? "You're in the pool — click to stop" : "Click to join and start receiving calls"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 14px 6px 8px",
              borderRadius: 999,
              border: `1px solid ${on ? "#16a34a" : "#cbd5e1"}`,
              background: on ? "#16a34a" : "#f1f5f9",
              color: on ? "#fff" : "#475569",
              fontWeight: 700,
              fontSize: 13,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            <span style={{ width: 34, height: 20, borderRadius: 999, background: on ? "rgba(255,255,255,.35)" : "#cbd5e1", position: "relative" }}>
              <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
            </span>
            {busy ? "…" : on ? "ON — receiving calls" : "OFF — join to start"}
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 12 }}>
          Join and it dials straight from unassigned New Leads, sending you the next customer the moment you're free — no campaign setup needed.
        </div>

        {on && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: call ? (isRinging ? "#fff7ed" : "#f0fdf4") : "#f8fafc",
              border: `1px solid ${call ? (isRinging ? "#fed7aa" : "#bbf7d0") : "#eef0f4"}`,
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 14,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: call ? (isRinging ? "#f59e0b" : "#16a34a") : "#94a3b8",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, fontSize: 13 }}>
              {call ? (
                <>
                  <strong>{isRinging ? "Ringing the customer…" : "Connected"}</strong>
                  {" — "}
                  {lead?.name || call.contactName || "Customer"}{" "}
                  <span style={{ color: "#94a3b8" }}>{lead?.phone || call.phone}</span>
                  {isConnected && (
                    <span style={{ marginLeft: 10, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {fmtDuration(callSeconds)}
                    </span>
                  )}
                </>
              ) : (
                <span style={{ color: "#64748b" }}>No active call right now — waiting for the next lead.</span>
              )}
            </div>
          </div>
        )}

        {data && data.poolExhausted && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, marginBottom: 12 }}>
            <PoweroffOutlined /> No New leads left to dial right now — it'll pick up automatically as fresh leads come in.
          </div>
        )}

        {data && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            {[
              ["Leads Waiting", data.leadsWaiting, "#2563EB"],
              ["Agents In Pool", data.participants, "#16A34A"],
              ["My Status", data.myStatus, on ? "#16A34A" : "#94A3B8"],
            ].map(([l, v, c]) => (
              <div key={l} style={{ flex: "1 1 130px", background: "#f8fafc", border: "1px solid #eef0f4", borderRadius: 12, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: c }} />
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{l}</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>My Calls Today</div>
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead><tr><th>Contact</th><th>Duration</th><th>Status</th><th>Outcome</th></tr></thead>
            <tbody>
              {(!data || data.recentCalls.length === 0) && <tr><td colSpan={4}><div className="hub-empty">No calls yet today.</div></td></tr>}
              {data && data.recentCalls.map((c) => (
                <tr key={c._id}>
                  <td>{c.contactName}<div style={{ fontSize: 11, color: "#94a3b8" }}>{c.phone}</div></td>
                  <td>{fmtDuration(c.durationSec)}</td>
                  <td><span className={`hub-badge ${CALL_STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                  <td>{c.disposition || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <UsedLeads />
    </div>
  );
}

export default function AutoDialer() {
  return <InstantLeadPool />;
}
