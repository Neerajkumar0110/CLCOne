import React, { useEffect, useState } from "react";
import HubTabs from "@/components/HubTabs";
import { HubBarChart, HubBarChartLabels, HubDonut } from "@/components/HubCharts";
import { request } from "@/request";

const RANGE_OPTIONS = ["1M", "3M", "6M", "1Y"];
const ALL_TEAMS = "__all_teams__";
const ALL_AGENTS = "__all_agents__";

function fmtMoney(n) {
  return `₹${Math.round((n || 0) / 1000).toLocaleString()}k`;
}

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Team-wide totals, weekly trend and a per-agent leaderboard — everything
// scoped server-side by GET /api/performance/summary (backend/src/controllers/
// appControllers/performanceController/summary.js): management roles see the
// whole company here, everyone else only ever gets their own team's rows.
function TeamPerformance({ data, metric }) {
  const { agents, totals, weeklyTrend } = data;

  const chartData = weeklyTrend.map((w) => ({
    label: w.label,
    values: [
      {
        value: metric === "calls" ? w.calls : w.sales / 1000,
        color: "#2563EB",
        tooltip: metric === "calls" ? `${w.calls.toLocaleString()} calls` : fmtMoney(w.sales),
      },
    ],
  }));

  const kpis =
    metric === "calls"
      ? [
          { label: "Total Calls", value: totals.calls.toLocaleString() },
          { label: "Avg Connect Rate", value: `${totals.connectRatePct}%` },
          { label: "Deals Closed", value: totals.deals },
          { label: "Active Agents", value: agents.length },
        ]
      : [
          { label: "Total Sales", value: fmtMoney(totals.sales) },
          { label: "Avg Deal Size", value: fmtMoney(totals.avgDealSize) },
          { label: "Deals Closed", value: totals.deals },
          { label: "Active Agents", value: agents.length },
        ];

  const donutSegments = agents
    .filter((a) => (metric === "calls" ? a.calls : a.sales) > 0)
    .map((a) => ({
      label: initials(a.name),
      value: metric === "calls" ? a.calls : Math.round(a.sales / 1000),
      color: a.color,
    }));

  return (
    <div className="hub-stack">
      <div className="hub-kpi-row">
        {kpis.map((k, idx) => (
          <div className="hub-kpi" key={k.label} style={{ animationDelay: `${idx * 0.05}s` }}>
            <div className="hub-kpi-label">{k.label}</div>
            <div className="hub-kpi-value">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="hub-grid-2">
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>Weekly Trend — {metric === "calls" ? "Calls" : "Sales"}</h3>
          </div>
          {weeklyTrend.length > 0 ? (
            <>
              <HubBarChart data={chartData} />
              <HubBarChartLabels labels={weeklyTrend.map((w) => w.label)} />
            </>
          ) : (
            <div className="hub-empty">No activity in this period.</div>
          )}
        </div>

        <div className="hub-card">
          <div className="hub-card-header">
            <h3>Team Contribution Share</h3>
          </div>
          {donutSegments.length > 0 ? (
            <HubDonut centerLabel={metric === "calls" ? "Calls" : "Sales"} segments={donutSegments} />
          ) : (
            <div className="hub-empty">No activity in this period.</div>
          )}
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Leaderboard</h3>
        </div>
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>{metric === "calls" ? "Calls Made" : "Sales Value"}</th>
                <th>{metric === "calls" ? "Connected" : "Deals Closed"}</th>
                <th>{metric === "calls" ? "Connect Rate" : "Share of Team Sales"}</th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="hub-empty">No agents in this scope.</div>
                  </td>
                </tr>
              )}
              {[...agents]
                .sort((a, b) => (metric === "calls" ? b.calls - a.calls : b.sales - a.sales))
                .map((a) => {
                  const pct =
                    metric === "calls"
                      ? a.connectRatePct
                      : totals.sales
                      ? Math.round((a.sales / totals.sales) * 100)
                      : 0;
                  return (
                    <tr key={a.name}>
                      <td>
                        <div className="hub-person">
                          <div className="hub-avatar" style={{ background: a.color }}>
                            {initials(a.name)}
                          </div>
                          {a.name}
                        </div>
                      </td>
                      <td>{metric === "calls" ? a.calls.toLocaleString() : fmtMoney(a.sales)}</td>
                      <td>{metric === "calls" ? a.connected.toLocaleString() : a.deals}</td>
                      <td>
                        <div className="hub-progress">
                          <div className="hub-progress-track">
                            <div
                              className="hub-progress-fill"
                              style={{ width: `${Math.min(pct, 100)}%`, background: a.color }}
                            />
                          </div>
                          <span>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function IndividualPerformance({ data, metric }) {
  const { agents, totals } = data;
  const [selected, setSelected] = useState(agents[0]?.name);

  useEffect(() => {
    if (!agents.find((a) => a.name === selected)) {
      setSelected(agents[0]?.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  const agent = agents.find((a) => a.name === selected) || agents[0];

  if (!agent) {
    return (
      <div className="hub-card">
        <div className="hub-empty">No performance data for this scope yet.</div>
      </div>
    );
  }

  const rank =
    [...agents]
      .sort((a, b) => (metric === "calls" ? b.calls - a.calls : b.sales - a.sales))
      .findIndex((a) => a.name === agent.name) + 1;
  const salesSharePct = totals.sales ? Math.round((agent.sales / totals.sales) * 100) : 0;

  return (
    <div className="hub-stack">
      {agents.length > 1 && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>Select Agent</h3>
          </div>
          <div className="hub-btn-group">
            {agents.map((a) => (
              <button
                key={a.name}
                type="button"
                className="hub-btn"
                style={
                  selected === a.name
                    ? { background: a.color, borderColor: a.color, color: "#fff" }
                    : {}
                }
                onClick={() => setSelected(a.name)}
              >
                <span
                  className="hub-avatar"
                  style={{ width: 20, height: 20, fontSize: 10, background: a.color, color: "#fff" }}
                >
                  {initials(a.name)}
                </span>
                {a.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label">{metric === "calls" ? "Calls Made" : "Sales Value"}</div>
          <div className="hub-kpi-value">
            {metric === "calls" ? agent.calls.toLocaleString() : fmtMoney(agent.sales)}
          </div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">{metric === "calls" ? "Connect Rate" : "Deals Closed"}</div>
          <div className="hub-kpi-value">{metric === "calls" ? `${agent.connectRatePct}%` : agent.deals}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">{metric === "calls" ? "Avg Call Duration" : "Share of Team Sales"}</div>
          <div className="hub-kpi-value">{metric === "calls" ? agent.avgDurationLabel : `${salesSharePct}%`}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Rank in Scope</div>
          <div className="hub-kpi-value">#{rank}</div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>{agent.name} — Call Outcome</h3>
        </div>
        {agent.calls > 0 ? (
          <HubDonut
            centerLabel="Calls"
            segments={[
              { label: "Connected", value: agent.connected, color: "#2563EB" },
              { label: "Missed", value: agent.missed, color: "#FF4D4F" },
            ]}
          />
        ) : (
          <div className="hub-empty">No calls in this period.</div>
        )}
      </div>
    </div>
  );
}

export default function Performance() {
  const [tab, setTab] = useState("team");
  const [metric, setMetric] = useState("calls");
  const [range, setRange] = useState("1M");
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [agentFilter, setAgentFilter] = useState(ALL_AGENTS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadPerformance = async () => {
    setLoading(true);
    const options = { range };
    if (teamFilter !== ALL_TEAMS) options.team = teamFilter;
    if (agentFilter !== ALL_AGENTS) options.agent = agentFilter;
    const res = await request.get({ entity: "performance/summary?" + new URLSearchParams(options).toString() });
    setData(res?.success ? res.result : null);
    setLoading(false);
  };

  useEffect(() => {
    loadPerformance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, teamFilter, agentFilter]);

  const isManagement = data?.scope?.isManagement;

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Performance</h2>
          <p>
            {isManagement
              ? "Company-wide — filter by team or by one person below"
              : `Your data${data?.scope?.team ? ` and ${data.scope.team}'s` : ""}`}
          </p>
        </div>

        <div className="hub-row" style={{ gap: 12, flexWrap: "wrap" }}>
          {isManagement && (
            <>
              <select
                className="hub-select"
                value={teamFilter}
                onChange={(e) => {
                  setTeamFilter(e.target.value);
                  setAgentFilter(ALL_AGENTS);
                }}
              >
                <option value={ALL_TEAMS}>All Teams</option>
                {(data?.filters?.teams || []).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select className="hub-select" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
                <option value={ALL_AGENTS}>All People</option>
                {(data?.filters?.agents || []).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </>
          )}
          <select className="hub-select" value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGE_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <div className="hub-pill-filter">
            {["calls", "sales"].map((m) => (
              <button
                key={m}
                type="button"
                className={`hub-pill-btn ${metric === m ? "active" : ""}`}
                onClick={() => setMetric(m)}
              >
                {m === "calls" ? "Calls" : "Sales"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <HubTabs
        tabs={[
          { key: "team", label: "Team Performance" },
          { key: "individual", label: "Individual Performance" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {!data ? (
        <div className="hub-card">
          <div className="hub-empty">{loading ? "Loading performance…" : "Couldn't load performance data."}</div>
        </div>
      ) : tab === "team" ? (
        <TeamPerformance data={data} metric={metric} />
      ) : (
        <IndividualPerformance data={data} metric={metric} />
      )}
    </div>
  );
}
