import React, { useState } from "react";
import { request } from "@/request";
import { PhoneOutlined } from "@ant-design/icons";
import { fmtDuration, usePoll } from "./shared";

const CARDS = [
  { key: "totalCalls", label: "Total Calls", color: "#2563EB" },
  { key: "todaysCalls", label: "Today's Calls", color: "#0EA5E9" },
  { key: "connectedCalls", label: "Connected", color: "#16A34A" },
  { key: "missedCalls", label: "Missed", color: "#F59E0B" },
  { key: "failedCalls", label: "Failed", color: "#EF4444" },
  { key: "liveCalls", label: "Live Now", color: "#8B5CF6" },
  { key: "agentsAvailable", label: "Agents Available", color: "#16A34A" },
  { key: "agentsOnCall", label: "Agents On Call", color: "#2563EB" },
  { key: "activeCampaigns", label: "Active Campaigns", color: "#6366F1" },
];

export default function CallingDashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);

  usePoll(async () => {
    const r = await request.get({ entity: "calling/dashboard" });
    if (r?.success) {
      setD(r.result);
      setErr(false);
    } else setErr(true);
  }, 5000);

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><PhoneOutlined /> Calling Dashboard</h3>
        </div>

        {err && !d && <div className="hub-empty">Couldn&rsquo;t load the dashboard.</div>}
        {!d && !err && <div className="hub-empty">Loading…</div>}

        {d && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {CARDS.map((c) => (
                <div
                  key={c.key}
                  style={{
                    flex: "1 1 140px",
                    minWidth: 130,
                    background: "#f8fafc",
                    border: "1px solid #eef0f4",
                    borderRadius: 12,
                    padding: "14px 16px",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: c.color }} />
                  <div style={{ fontSize: 11.5, color: "#64748b", fontWeight: 600 }}>{c.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{d[c.key] ?? 0}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
              <Stat label="Total Talk Time" value={fmtDuration(d.totalDurationSec)} />
              <Stat label="Avg Call Duration" value={fmtDuration(d.avgDurationSec)} />
              <Stat label="Answer Rate" value={`${d.answerRate}%`} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ flex: "1 1 160px", minWidth: 150, background: "#fff", border: "1px solid #eef0f4", borderRadius: 12, padding: "12px 16px" }}>
      <div style={{ fontSize: 11.5, color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{value}</div>
    </div>
  );
}
