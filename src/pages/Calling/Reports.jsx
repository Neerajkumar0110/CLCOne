import React, { useEffect, useState } from "react";
import { request } from "@/request";
import { BarChartOutlined } from "@ant-design/icons";
import { fmtDuration, useCallingMeta } from "./shared";

const RANGES = ["1W", "1M", "3M", "6M", "1Y"];

export default function Reports() {
  const meta = useCallingMeta();
  const [campaigns, setCampaigns] = useState([]);
  const [range, setRange] = useState("1M");
  const [campaign, setCampaign] = useState("");
  const [agent, setAgent] = useState("");
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request.get({ entity: "calling/campaigns?items=100" }).then((r) => r?.success && setCampaigns(r.result));
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const params = new URLSearchParams({ range });
      if (campaign) params.set("campaign", campaign);
      if (agent) params.set("agent", agent);
      const r = await request.get({ entity: `calling/reports?${params}` });
      setD(r?.success ? r.result : null);
      setLoading(false);
    })();
  }, [range, campaign, agent]);

  const dispLabel = (code) => (meta.dispositions || []).find((x) => x.code === code)?.label || code;

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><BarChartOutlined /> Calling Reports</h3>
          <div className="hub-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select className="hub-select" style={{ maxWidth: 110 }} value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="hub-select" style={{ maxWidth: 200 }} value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">All campaigns</option>
              {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
            <select className="hub-select" style={{ maxWidth: 180 }} value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">All agents</option>
              {(meta.agents || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
          </div>
        </div>

        {loading && <div className="hub-empty">Loading…</div>}
        {!loading && d && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <KPI label="Calls Made" value={d.callsMade} />
            <KPI label="Connected" value={d.connectedCalls} />
            <KPI label="Answer Rate" value={`${d.answerRate}%`} />
            <KPI label="Avg Duration" value={fmtDuration(d.avgDurationSec)} />
            <KPI label="Total Talk Time" value={fmtDuration(d.totalTalkSec)} />
            <KPI label="Callbacks Done" value={`${d.callbackPerformance.done}/${d.callbackPerformance.total} (${d.callbackPerformance.completionRate}%)`} />
          </div>
        )}
      </div>

      {!loading && d && (
        <>
          <TableCard
            title="Agent Performance"
            head={["Agent", "Made", "Connected", "Answer Rate", "Avg Dur."]}
            rows={d.agentPerformance.map((a) => [a.agent, a.made, a.connected, `${a.answerRate}%`, fmtDuration(a.avgDurationSec)])}
          />
          <TableCard
            title="Campaign Performance"
            head={["Campaign", "Made", "Connected", "Answer Rate"]}
            rows={d.campaignPerformance.map((c) => [c.campaign, c.made, c.connected, `${c.answerRate}%`])}
          />
          <TableCard
            title="Call Dispositions"
            head={["Disposition", "Count"]}
            rows={d.dispositions.map((x) => [dispLabel(x.code), x.count])}
          />
        </>
      )}
    </div>
  );
}

function KPI({ label, value }) {
  return (
    <div style={{ flex: "1 1 150px", minWidth: 140, background: "#f8fafc", border: "1px solid #eef0f4", borderRadius: 12, padding: "12px 16px" }}>
      <div style={{ fontSize: 11.5, color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{value}</div>
    </div>
  );
}

function TableCard({ title, head, rows }) {
  return (
    <div className="hub-card">
      <div className="hub-card-header"><h3>{title}</h3></div>
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={head.length}><div className="hub-empty">No data.</div></td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
