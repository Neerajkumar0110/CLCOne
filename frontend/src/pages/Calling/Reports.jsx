import React, { useEffect, useState } from "react";
import { request } from "@/request";
import { BarChartOutlined } from "@ant-design/icons";
import { fmtDuration, fmtDateTime, useCallingMeta } from "./shared";

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
            <div className="lsb-seg su-seg" role="group" aria-label="Range">
              {RANGES.map((r) => (
                <button key={r} type="button" className={range === r ? "on" : ""} aria-pressed={range === r} onClick={() => setRange(r)}>{r}</button>
              ))}
            </div>
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
          <div className="su-kpis">
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
            head={["Agent", "Made", "Connected", "Answer Rate", "Avg Dur.", "Missed"]}
            rows={d.agentPerformance.map((a) => [a.agent, a.made, a.connected, `${a.answerRate}%`, fmtDuration(a.avgDurationSec), a.missed])}
          />
          <TableCard
            title="Campaign Performance"
            head={["Campaign", "Made", "Connected", "Answer Rate"]}
            rows={d.campaignPerformance.map((c) => [c.campaign, c.made, c.connected, `${c.answerRate}%`])}
          />
          <DispositionBars items={d.dispositions.map((x) => ({ label: dispLabel(x.code), count: x.count }))} />
        </>
      )}

      {meta.tier === "admin" && <MissedCalls range={range} />}
    </div>
  );
}

// Every call (inbound IVR included) where the call reached a specific agent
// and that agent never picked up — see CallRecord.missedByAgent /
// plivoAnswer.js's leg=agent-hangup. Deliberately its own fetch, not folded
// into the summary above: the Agent/Campaign Performance tables above are
// scoped to campaign-bound calls only, which excludes inbound IVR calls
// entirely (they never carry a `campaign`) — exactly the calls this is for.
function MissedCalls({ range }) {
  const [d, setD] = useState(null);

  useEffect(() => {
    request.get({ entity: `calling/missed-calls?range=${range}` }).then((r) => setD(r?.success ? r.result : null));
  }, [range]);

  if (!d) return null;

  return (
    <>
      <TableCard
        title={`Missed Calls by Agent — ${d.total} total`}
        head={["Agent", "Missed"]}
        rows={d.byAgent.map((a) => [a.name, a.missed])}
      />
      <TableCard
        title="Recent Missed Calls"
        head={["Contact", "Phone", "Agent", "Direction", "When"]}
        rows={d.recent.map((r) => [r.contactName || "—", r.phone || "—", r.agentName || "—", r.direction, fmtDateTime(r.missedByAgentAt || r.created)])}
      />
    </>
  );
}

function KPI({ label, value }) {
  return (
    <div className="su-kpi">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

// Design: "Saved response after talking" — the same disposition counts as a horizontal bar chart.
function DispositionBars({ items }) {
  const rows = [...items].sort((a, b) => b.count - a.count);
  const total = rows.reduce((t, r) => t + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="hub-card">
      <div className="lsb-ch"><div><h3>Call dispositions</h3><p>Saved response after talking · count and share</p></div></div>
      {rows.length === 0 ? (
        <div className="hub-empty"><b>No data available for the selected filters.</b></div>
      ) : (
        rows.map((r) => (
          <div key={r.label} className="su-hb">
            <span title={r.label}>{r.label}</span>
            <span className="t"><b style={{ width: `${(r.count / max) * 100}%` }} /></span>
            <span className="n">{r.count.toLocaleString("en-IN")} <em>{total ? Math.round((r.count / total) * 100) : 0}%</em></span>
          </div>
        ))
      )}
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
            {rows.length === 0 && <tr><td colSpan={head.length}><div className="hub-empty"><b>No data available for the selected filters.</b></div></td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
