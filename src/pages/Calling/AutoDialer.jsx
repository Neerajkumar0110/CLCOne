import React, { useEffect, useRef, useState } from "react";
import { request } from "@/request";
import { ThunderboltOutlined, PhoneOutlined } from "@ant-design/icons";
import { CALL_STATUS_BADGE, AGENT_STATUS_BADGE, usePoll } from "./shared";

export default function AutoDialer() {
  const [campaigns, setCampaigns] = useState([]);
  const [campId, setCampId] = useState("");
  const [state, setState] = useState(null);
  const [myStatus, setMyStatus] = useState("Offline");
  const campIdRef = useRef("");
  campIdRef.current = campId;

  useEffect(() => {
    request.get({ entity: "calling/campaigns?items=100" }).then((r) => {
      if (r?.success) {
        setCampaigns(r.result);
        const active = r.result.find((c) => c.status === "Active") || r.result[0];
        if (active) setCampId(active._id);
      }
    });
  }, []);

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
          <select className="hub-select" style={{ maxWidth: 260 }} value={campId} onChange={(e) => setCampId(e.target.value)}>
            <option value="">— pick a campaign —</option>
            {campaigns.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name} ({c.status})
              </option>
            ))}
          </select>
        </div>

        {!campId && <div className="hub-empty">Pick a campaign to see the dialer.</div>}

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
