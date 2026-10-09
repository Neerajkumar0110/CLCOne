import React, { useEffect, useState } from "react";
import { TreeSelect } from "antd";
import HubTabs from "@/components/HubTabs";
import { HubBarChart, HubBarChartLabels, HubDonut } from "@/components/HubCharts";
import { request } from "@/request";
import { roleDisplay } from "@/pages/UserManagement/Users";

const RANGE_OPTIONS = ["1M", "3M", "6M", "1Y"];
const ALL_TEAMS = "__all_teams__";
const ALL_AGENTS = "__all_agents__";
const ALL_ROLES = "__all_roles__";

// backend's orgTree.js nodes ({id, name, role, children}) -> antd
// TreeSelect's shape. `value` is the person's NAME, not their id — every
// other agent-scoped query in this app (Call.calledBy, Payment.createdBy,
// ?agent=) is already name-keyed, so this stays consistent instead of
// introducing a second identity scheme just for this picker.
function toTreeData(nodes) {
  return (nodes || []).map((n) => ({
    title: `${n.name}${n.role ? ` — ${roleDisplay(n.role)}` : ""}`,
    value: n.name,
    key: n.id,
    children: n.children && n.children.length ? toTreeData(n.children) : undefined,
  }));
}

function fmtMoney(n) {
  return `₹${Math.round((n || 0) / 1000).toLocaleString()}k`;
}

function currentPeriodLabel() {
  return new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
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
                <th>Role</th>
                <th>{metric === "calls" ? "Calls Made" : "Sales Value"}</th>
                <th>{metric === "calls" ? "Connected" : "Deals Closed"}</th>
                <th>{metric === "calls" ? "Connect Rate" : "Share of Team Sales"}</th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 && (
                <tr>
                  <td colSpan={5}>
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
                        <div className="hub-person" style={{ paddingLeft: (a.depth || 0) * 18 }}>
                          <div className="hub-avatar" style={{ background: a.color }}>
                            {initials(a.name)}
                          </div>
                          {a.name}
                        </div>
                      </td>
                      <td>
                        {a.role ? <span className="hub-badge hub-badge-blue">{roleDisplay(a.role)}</span> : "—"}
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

// Monthly target vs. actual for everyone in the caller's sales-hierarchy
// scope (GET /api/performance/targets — see backend's targetController).
// Editable only for rows "canSetTargets" allows (the caller is full-access,
// or has at least one person reporting up to them) — a leaf Sales Intern
// with nobody beneath them just sees their own numbers, read-only.
function TargetsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editAdmin, setEditAdmin] = useState(null);
  const [draft, setDraft] = useState({ targetCalls: "", targetDeals: "", targetRevenue: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await request.get({ entity: "performance/targets" });
    setData(res?.success ? res.result : null);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const startEdit = (row) => {
    setEditAdmin(row.admin);
    setDraft({
      targetCalls: row.targetCalls ?? "",
      targetDeals: row.targetDeals ?? "",
      targetRevenue: row.targetRevenue ?? "",
    });
  };

  const save = async (row) => {
    setSaving(true);
    const res = await request.post({
      entity: "performance/targets",
      jsonData: {
        admin: row.admin,
        targetCalls: draft.targetCalls === "" ? null : Number(draft.targetCalls),
        targetDeals: draft.targetDeals === "" ? null : Number(draft.targetDeals),
        targetRevenue: draft.targetRevenue === "" ? null : Number(draft.targetRevenue),
      },
    });
    setSaving(false);
    if (res?.success) {
      setEditAdmin(null);
      await load();
    }
  };

  if (loading) {
    return (
      <div className="hub-card">
        <div className="hub-empty">Loading targets…</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="hub-card">
        <div className="hub-empty">Couldn't load targets.</div>
      </div>
    );
  }

  const pctOf = (achieved, target) => (target ? Math.min(100, Math.round((achieved / target) * 100)) : null);

  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3>Monthly Targets — {currentPeriodLabel()}</h3>
      </div>
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Calls</th>
              <th>Deals</th>
              <th>Revenue</th>
              {data.canSetTargets && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={data.canSetTargets ? 6 : 5}>
                  <div className="hub-empty">No one in this scope yet.</div>
                </td>
              </tr>
            )}
            {data.rows.map((r) => {
              const isEditing = data.canSetTargets && editAdmin === r.admin;
              const callsPct = pctOf(r.achievedCalls, r.targetCalls);
              const dealsPct = pctOf(r.achievedDeals, r.targetDeals);
              const revPct = pctOf(r.achievedRevenue, r.targetRevenue);
              return (
                <tr key={r.admin || r.name}>
                  <td>
                    <div className="hub-person" style={{ paddingLeft: (r.depth || 0) * 18 }}>
                      <div className="hub-avatar" style={{ background: "#2563EB" }}>{initials(r.name)}</div>
                      {r.name}
                    </div>
                  </td>
                  <td>{r.role ? <span className="hub-badge hub-badge-blue">{roleDisplay(r.role)}</span> : "—"}</td>
                  {isEditing ? (
                    <>
                      <td>
                        <input
                          className="hub-input"
                          style={{ width: 80 }}
                          type="number"
                          min="0"
                          placeholder="target"
                          value={draft.targetCalls}
                          onChange={(e) => setDraft((d) => ({ ...d, targetCalls: e.target.value }))}
                        />
                      </td>
                      <td>
                        <input
                          className="hub-input"
                          style={{ width: 70 }}
                          type="number"
                          min="0"
                          placeholder="target"
                          value={draft.targetDeals}
                          onChange={(e) => setDraft((d) => ({ ...d, targetDeals: e.target.value }))}
                        />
                      </td>
                      <td>
                        <input
                          className="hub-input"
                          style={{ width: 100 }}
                          type="number"
                          min="0"
                          placeholder="target ₹"
                          value={draft.targetRevenue}
                          onChange={(e) => setDraft((d) => ({ ...d, targetRevenue: e.target.value }))}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        {r.targetCalls != null ? (
                          <div className="hub-progress">
                            <div className="hub-progress-track">
                              <div className="hub-progress-fill" style={{ width: `${callsPct}%`, background: "#2563EB" }} />
                            </div>
                            <span>{r.achievedCalls}/{r.targetCalls}</span>
                          </div>
                        ) : (
                          <span style={{ color: "var(--hub-muted)" }}>{r.achievedCalls} (no target)</span>
                        )}
                      </td>
                      <td>
                        {r.targetDeals != null ? (
                          <div className="hub-progress">
                            <div className="hub-progress-track">
                              <div className="hub-progress-fill" style={{ width: `${dealsPct}%`, background: "#16A34A" }} />
                            </div>
                            <span>{r.achievedDeals}/{r.targetDeals}</span>
                          </div>
                        ) : (
                          <span style={{ color: "var(--hub-muted)" }}>{r.achievedDeals} (no target)</span>
                        )}
                      </td>
                      <td>
                        {r.targetRevenue != null ? (
                          <div className="hub-progress">
                            <div className="hub-progress-track">
                              <div className="hub-progress-fill" style={{ width: `${revPct}%`, background: "#D97706" }} />
                            </div>
                            <span>{fmtMoney(r.achievedRevenue)}/{fmtMoney(r.targetRevenue)}</span>
                          </div>
                        ) : (
                          <span style={{ color: "var(--hub-muted)" }}>{fmtMoney(r.achievedRevenue)} (no target)</span>
                        )}
                      </td>
                    </>
                  )}
                  {data.canSetTargets && (
                    <td>
                      {isEditing ? (
                        <div className="hub-row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <button type="button" className="hub-btn hub-btn-primary" disabled={saving} onClick={() => save(r)}>
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button type="button" className="hub-btn" onClick={() => setEditAdmin(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button type="button" className="hub-btn" disabled={!r.admin} onClick={() => startEdit(r)}>
                          Set Target
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
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
  const [roleFilter, setRoleFilter] = useState(ALL_ROLES);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [orgTreeData, setOrgTreeData] = useState([]);

  useEffect(() => {
    // 403s harmlessly for a non-full-access caller — they have nothing to
    // browse outside their own hard-scoped chain anyway, so the TreeSelect
    // below just never renders for them.
    request.get({ entity: "performance/org-tree" }).then((res) => {
      if (res?.success) setOrgTreeData(res.result);
    });
  }, []);

  const loadPerformance = async () => {
    setLoading(true);
    const options = { range };
    if (teamFilter !== ALL_TEAMS) options.team = teamFilter;
    if (agentFilter !== ALL_AGENTS) options.agent = agentFilter;
    if (roleFilter !== ALL_ROLES) options.role = roleFilter;
    const res = await request.get({ entity: "performance/summary?" + new URLSearchParams(options).toString() });
    setData(res?.success ? res.result : null);
    setLoading(false);
  };

  useEffect(() => {
    loadPerformance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, teamFilter, agentFilter, roleFilter]);

  const isManagement = data?.scope?.isManagement;
  const scopeNote = isManagement
    ? "Company-wide — filter by team or by one person below"
    : data?.scope?.isHierarchy
    ? `Your data and everyone reporting up to you (${data.scope.teamSize} people)`
    : `Your data${data?.scope?.team ? ` and ${data.scope.team}'s` : ""}`;

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Performance</h2>
          <p>{scopeNote}</p>
        </div>

        <div className="hub-row" style={{ gap: 12, flexWrap: "wrap" }}>
          {isManagement && (
            <>
              <select
                className="hub-select"
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setAgentFilter(ALL_AGENTS);
                }}
              >
                <option value={ALL_ROLES}>All Roles</option>
                {(data?.filters?.roles || []).map((r) => (
                  <option key={r} value={r}>{roleDisplay(r)}</option>
                ))}
              </select>
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
              <TreeSelect
                className="hub-select"
                style={{ minWidth: 220 }}
                value={agentFilter === ALL_AGENTS ? undefined : agentFilter}
                placeholder="All People"
                allowClear
                treeDefaultExpandAll={false}
                showSearch
                treeNodeFilterProp="title"
                dropdownMatchSelectWidth={280}
                treeData={orgTreeData.length ? toTreeData(orgTreeData) : undefined}
                notFoundContent={<div className="hub-empty" style={{ padding: 8 }}>No one in the sales hierarchy yet.</div>}
                onChange={(v) => setAgentFilter(v || ALL_AGENTS)}
              />
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
          { key: "targets", label: "Targets" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "targets" ? (
        <TargetsTab />
      ) : !data ? (
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
