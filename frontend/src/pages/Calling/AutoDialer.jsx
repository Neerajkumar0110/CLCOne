import React, { useEffect, useRef, useState } from "react";
import { request } from "@/request";
import { ThunderboltOutlined, PhoneOutlined } from "@ant-design/icons";
import { CALL_STATUS_BADGE, AGENT_STATUS_BADGE, usePoll } from "./shared";

export default function AutoDialer() {
  const [campaigns, setCampaigns] = useState([]);
  const [campId, setCampId] = useState("");
  const [state, setState] = useState(null);
  const [myStatus, setMyStatus] = useState("Offline");
  const [busy, setBusy] = useState(false);
  const campIdRef = useRef("");
  campIdRef.current = campId;

  const loadCampaigns = async (keepId) => {
    const r = await request.get({ entity: "calling/campaigns?items=100" });
    if (r?.success) {
      setCampaigns(r.result);
      if (!keepId) {
        const active = r.result.find((c) => c.status === "Active") || r.result[0];
        if (active) setCampId(active._id);
      }
    }
  };

  useEffect(() => {
    loadCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const camp = campaigns.find((c) => c._id === campId) || null;
  const campOn = camp?.status === "Active";

  // OFF -> click -> ON (campaign Active, auto-dialer starts feeding agents).
  const toggleCampaign = async () => {
    if (!camp || busy) return;
    setBusy(true);
    const action = campOn ? "pause" : "start";
    const r = await request.post({ entity: `calling/campaigns/${camp._id}/action`, jsonData: { action } });
    if (!r?.success) window.alert(r?.message || "Could not change the campaign.");
    await loadCampaigns(true);
    setBusy(false);
  };

  usePoll(
    async () => {
      const id = campIdRef.current;
      if (!id) return;
      const r = await request.get({ entity: `calling/dialer/${id}` });
      if (r?.success) setState(r.result);
    },
    3000,
    [campId]
  );

  const setPresence = async (status) => {
    if (!campId) return;
    const r = await request.post({ entity: `calling/dialer/${campId}/presence`, jsonData: { status } });
    if (r?.success) setMyStatus(status);
  };

  const dialNext = async () => {
    if (!campId) return;
    await request.post({ entity: `calling/dialer/${campId}/dial-next`, jsonData: {} });
  };

  const tiles = state
    ? [
        ["Leads Waiting", state.leadsWaiting, "#2563EB"],
        ["Calls In Progress", state.callsInProgress, "#0EA5E9"],
        ["Connected", state.connectedCalls, "#16A34A"],
        ["Agents Available", state.agentsAvailable, "#16A34A"],
        ["Agents Busy", state.agentsBusy, "#F59E0B"],
      ]
    : [];

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><ThunderboltOutlined /> Auto Dialer</h3>
          <div className="hub-row" style={{ gap: 10, alignItems: "center" }}>
            <select className="hub-select" style={{ maxWidth: 260 }} value={campId} onChange={(e) => setCampId(e.target.value)}>
              <option value="">— pick a campaign —</option>
              {campaigns.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>

            {camp && (
              <button
                type="button"
                onClick={toggleCampaign}
                disabled={busy || ["Completed", "Cancelled"].includes(camp.status)}
                title={campOn ? "Campaigning is ON — click to stop" : "Campaigning is OFF — click to start"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 14px 6px 8px",
                  borderRadius: 999,
                  border: `1px solid ${campOn ? "#16a34a" : "#cbd5e1"}`,
                  background: campOn ? "#16a34a" : "#f1f5f9",
                  color: campOn ? "#fff" : "#475569",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: busy ? "wait" : "pointer",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 20,
                    borderRadius: 999,
                    background: campOn ? "rgba(255,255,255,.35)" : "#cbd5e1",
                    position: "relative",
                    transition: "background .15s",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: campOn ? 16 : 2,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left .15s",
                    }}
                  />
                </span>
                {busy ? "…" : campOn ? "Campaigning ON" : "Start Campaigning"}
              </button>
            )}
          </div>
        </div>

        {!campId && <div className="hub-empty">Pick a campaign to see the dialer.</div>}
        {camp && !campOn && !["Completed", "Cancelled"].includes(camp.status) && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, marginBottom: 12 }}>
            Campaign is <strong>{camp.status}</strong> — no calls will be placed. Toggle <strong>Start Campaigning</strong> above to go live.
          </div>
        )}

        {campId && state && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
              {tiles.map(([l, v, c]) => (
                <div key={l} style={{ flex: "1 1 130px", background: "#f8fafc", border: "1px solid #eef0f4", borderRadius: 12, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: c }} />
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{l}</div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>{v}</div>
                </div>
              ))}
            </div>

            <div className="hub-row" style={{ gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Next Lead</div>
                <div style={{ fontWeight: 700 }}>
                  {state.nextLead ? `${state.nextLead.name} · ${state.nextLead.phone}` : "— none —"}
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <div className="hub-row" style={{ gap: 6 }}>
                <span style={{ fontSize: 12, color: "#64748b" }}>My status:</span>
                <span className={`hub-badge ${AGENT_STATUS_BADGE[myStatus]}`}>{myStatus}</span>
                <button type="button" className="hub-btn" onClick={() => setPresence("Available")}>Go Available</button>
                <button type="button" className="hub-btn" onClick={() => setPresence("Paused")}>Pause</button>
                <button type="button" className="hub-btn" onClick={() => setPresence("Offline")}>Go Offline</button>
                <button type="button" className="hub-btn hub-btn-primary" onClick={dialNext}>
                  <PhoneOutlined /> Dial Next
                </button>
              </div>
            </div>

            <div className="hub-grid-2" style={{ gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Agents</div>
                <div className="hub-table-wrapper">
                  <table className="hub-table">
                    <thead><tr><th>Agent</th><th>Status</th><th>Calls</th></tr></thead>
                    <tbody>
                      {state.agents.length === 0 && <tr><td colSpan={3}><div className="hub-empty">No agents online.</div></td></tr>}
                      {state.agents.map((a) => (
                        <tr key={a._id || a.name}>
                          <td>{a.name}</td>
                          <td><span className={`hub-badge ${AGENT_STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                          <td>{a.callsToday}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Live Calls</div>
                <div className="hub-table-wrapper">
                  <table className="hub-table">
                    <thead><tr><th>Contact</th><th>Agent</th><th>Status</th></tr></thead>
                    <tbody>
                      {state.liveCalls.length === 0 && <tr><td colSpan={3}><div className="hub-empty">No live calls.</div></td></tr>}
                      {state.liveCalls.map((c) => (
                        <tr key={c._id}>
                          <td>{c.contactName}<div style={{ fontSize: 11, color: "#94a3b8" }}>{c.phone}</div></td>
                          <td>{c.agentName || "—"}</td>
                          <td><span className={`hub-badge ${CALL_STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
