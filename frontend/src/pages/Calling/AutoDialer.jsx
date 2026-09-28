import React, { useState } from "react";
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

  const load = async () => {
    if (!isSales) return;
    const r = await request.get({ entity: "calling/lead-pool/status" });
    if (r?.success) setData(r.result);
  };
  usePoll(load, 4000, [isSales]);

  if (!isSales) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const r = await request.post({ entity: "calling/lead-pool/toggle", jsonData: { on: !data?.on } });
    if (!r?.success) window.alert(r?.message || "Could not change your Instant Lead Pool status.");
    await load();
    setBusy(false);
  };

  const on = !!data?.on;

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
