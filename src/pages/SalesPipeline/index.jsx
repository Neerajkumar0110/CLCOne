import React, { useEffect, useMemo, useState } from "react";
import { request } from "@/request";
import { FunnelPlotOutlined, ReloadOutlined } from "@ant-design/icons";

// Live sales pipeline — a weighted-funnel roll-up computed from the Deals
// tab (entity `salesdeal`). No dedicated backend endpoint: deal volumes are
// small, so we pull the list once and aggregate on the client.

const OPEN_STAGES = ["Qualification", "Needs Analysis", "Proposal", "Negotiation"];
const CLOSED_WON = "Closed Won";
const CLOSED_LOST = "Closed Lost";

// Fallback win-probability per stage when a deal has no explicit probability.
const STAGE_PROB = {
  Qualification: 10,
  "Needs Analysis": 25,
  Proposal: 50,
  Negotiation: 75,
};

const STAGE_COLOR = {
  Qualification: "#2563EB",
  "Needs Analysis": "#0EA5E9",
  Proposal: "#F97316",
  Negotiation: "#8B5CF6",
};

function money(n, code = "INR") {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code || "INR",
      maximumFractionDigits: 0,
    }).format(v);
  } catch (e) {
    return `${code || ""} ${Math.round(v).toLocaleString()}`.trim();
  }
}

function daysBetween(a, b) {
  return Math.max(0, Math.round((b - a) / 86400000));
}

export default function SalesPipeline() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [stageFilter, setStageFilter] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(false);
    const res = await request.listAll({ entity: "salesdeal" });
    if (res?.success && Array.isArray(res.result)) setDeals(res.result);
    else setError(true);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const now = Date.now();
    const open = deals.filter((d) => !d.stage || OPEN_STAGES.includes(d.stage));
    const won = deals.filter((d) => d.stage === CLOSED_WON);
    const lost = deals.filter((d) => d.stage === CLOSED_LOST);

    const pipelineValue = open.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const weighted = open.reduce((s, d) => {
      const p = d.probability != null && d.probability !== "" ? Number(d.probability) : STAGE_PROB[d.stage] || 0;
      return s + ((Number(d.amount) || 0) * p) / 100;
    }, 0);
    const ages = open
      .map((d) => (d.created ? daysBetween(new Date(d.created).getTime(), now) : null))
      .filter((x) => x != null);
    const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;

    const wonValue = won.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;

    const byStage = OPEN_STAGES.map((st) => {
      const rows = open.filter((d) => (d.stage || "Qualification") === st);
      return {
        stage: st,
        color: STAGE_COLOR[st],
        count: rows.length,
        value: rows.reduce((s, d) => s + (Number(d.amount) || 0), 0),
      };
    });

    // Dominant currency for the KPI headline figures.
    const cc = {};
    open.forEach((d) => (cc[d.currency || "INR"] = (cc[d.currency || "INR"] || 0) + 1));
    const currency = Object.entries(cc).sort((a, b) => b[1] - a[1])[0]?.[0] || "INR";

    return { open, won, lost, pipelineValue, weighted, avgAge, wonValue, winRate, byStage, currency };
  }, [deals]);

  const tableRows = useMemo(() => {
    const rows = stageFilter
      ? stats.open.filter((d) => (d.stage || "Qualification") === stageFilter)
      : stats.open;
    return [...rows].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
  }, [stats.open, stageFilter]);

  const KPIS = [
    { label: "Open Deals", value: stats.open.length },
    { label: "Pipeline Value", value: money(stats.pipelineValue, stats.currency) },
    { label: "Weighted Value", value: money(stats.weighted, stats.currency) },
    { label: "Avg Deal Age", value: `${stats.avgAge} d` },
    { label: "Won Value", value: money(stats.wonValue, stats.currency) },
    { label: "Win Rate", value: `${stats.winRate}%` },
  ];

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><FunnelPlotOutlined /> Sales Pipeline</h3>
          <button type="button" className="hub-btn" onClick={load}>
            <ReloadOutlined /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="hub-empty">Loading pipeline…</div>
        ) : error ? (
          <div className="hub-empty">
            Couldn&rsquo;t load deals.
            <button type="button" className="hub-btn" style={{ marginLeft: 8 }} onClick={load}>
              Retry
            </button>
          </div>
        ) : deals.length === 0 ? (
          <div className="hub-empty">
            No deals yet. Add deals in the <strong>Deals</strong> tab and they roll up here automatically.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              {KPIS.map((k) => (
                <div
                  key={k.label}
                  style={{
                    flex: "1 1 150px",
                    minWidth: 140,
                    background: "#f8fafc",
                    border: "1px solid #eef0f4",
                    borderRadius: 12,
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{k.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* Stage funnel */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {stats.byStage.map((s) => {
                const on = stageFilter === s.stage;
                return (
                  <button
                    key={s.stage}
                    type="button"
                    onClick={() => setStageFilter(on ? null : s.stage)}
                    style={{
                      flex: "1 1 160px",
                      minWidth: 150,
                      textAlign: "left",
                      border: `1.5px solid ${on ? s.color : "#e2e8f0"}`,
                      background: on ? "#f5f7ff" : "#fff",
                      borderRadius: 12,
                      padding: "12px 14px",
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>{s.stage}</span>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 6 }}>{s.count}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{money(s.value, stats.currency)}</div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {!loading && !error && deals.length > 0 && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>
              {stageFilter ? `${stageFilter} · ` : "Open deals · "}
              {tableRows.length}
            </h3>
            {stageFilter && (
              <button type="button" className="hub-btn" onClick={() => setStageFilter(null)}>
                Clear
              </button>
            )}
          </div>
          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Account</th>
                  <th>Stage</th>
                  <th>Value</th>
                  <th>Prob.</th>
                  <th>Owner</th>
                  <th>Close Date</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 && (
                  <tr><td colSpan={8}><div className="hub-empty">No open deals in this stage.</div></td></tr>
                )}
                {tableRows.map((d) => {
                  const p =
                    d.probability != null && d.probability !== ""
                      ? Number(d.probability)
                      : STAGE_PROB[d.stage] || 0;
                  return (
                    <tr key={d._id}>
                      <td style={{ fontWeight: 600 }}>{d.title || "—"}</td>
                      <td>{d.account || "—"}</td>
                      <td>
                        <span
                          style={{
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: STAGE_COLOR[d.stage] || "#64748b",
                          }}
                        >
                          {d.stage || "Qualification"}
                        </span>
                      </td>
                      <td>{money(d.amount, d.currency || stats.currency)}</td>
                      <td>{p}%</td>
                      <td>{d.owner || "—"}</td>
                      <td>{d.closeDate ? new Date(d.closeDate).toLocaleDateString() : "—"}</td>
                      <td>{d.created ? `${daysBetween(new Date(d.created).getTime(), Date.now())} d` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
