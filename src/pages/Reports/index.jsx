import React, { useEffect, useMemo, useState } from "react";
import HubTabs from "@/components/HubTabs";
import { HubBarChart, HubBarChartLabels, HubDonut } from "@/components/HubCharts";
import { request } from "@/request";
import {
  DashboardOutlined,
  CustomerServiceOutlined,
  PhoneOutlined,
  TrophyOutlined,
  SolutionOutlined,
  ContainerOutlined,
  CreditCardOutlined,
  WalletOutlined,
  ShopOutlined,
  BarChartOutlined,
  TeamOutlined,
  MessageOutlined,
  SettingOutlined,
  ReconciliationOutlined,
  UserOutlined,
  DownloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";

/* =========================================================
   REAL DATA — GET /api/report/summary, GET /api/report/number-lookup,
   GET /api/call/list (all backend/src/controllers/appControllers/
   reportController & callController) replace what used to be fabricated
   agent/call arrays generated client-side.
========================================================= */

const REPORT_RANGE_OPTIONS = ["1W", "1M", "3M", "6M", "1Y"];

const REPORT_RANGE_LABEL = {
  "1W": "Last 1 Week",
  "1M": "Last 1 Month",
  "3M": "Last 3 Months",
  "6M": "Last 6 Months",
  "1Y": "Last 1 Year",
};

const CALL_STATUS_BADGE = {
  Connected: "hub-badge-green",
  Missed: "hub-badge-red",
  "No Answer": "hub-badge-yellow",
  Busy: "hub-badge-yellow",
  Voicemail: "hub-badge-gray",
};

function fmtInr(n) {
  return `₹${(Number(n || 0) / 100000).toFixed(2)}L`;
}

function fmtMinutesToHm(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtSecToMs(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function avgSecPerCall(a) {
  return a.calls ? Math.round((a.talkMinutes * 60) / a.calls) : 0;
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function fetchReportSummary({ range, team }) {
  const params = new URLSearchParams({ range });
  if (team && team !== "all") params.set("team", team);
  const res = await request.get({ entity: `report/summary?${params.toString()}` });
  return res?.success ? res.result : null;
}

// Shared by Overview360 / TalkTimeReport / UserCallReport — a single
// /report/summary?range=&team= call returns both the team-wide totals AND
// every member's own real stats, so "Individual" mode just picks one row
// out of `agents` instead of needing a second request.
function useReportSummary({ range, team }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchReportSummary({ range, team }).then((d) => {
      if (alive) { setData(d); setLoading(false); }
    });
    return () => { alive = false; };
  }, [range, team]);

  return { data, loading };
}

/* =========================================================
   NUMBER LOOKUP
========================================================= */

function NumberLookup() {
  const [input, setInput] = useState("");
  const [searched, setSearched] = useState(null); // { key, contactName, calls } | { key, notFound: true } | null
  const [searching, setSearching] = useState(false);

  const [statusFilter, setStatusFilter] = useState("All");
  const [range, setRange] = useState("1Y");
  const [mode, setMode] = useState("team");
  const [teamFilter, setTeamFilter] = useState("all");
  const [individualAgent, setIndividualAgent] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [count, setCount] = useState(0);
  const [browseCalls, setBrowseCalls] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(true);

  const { data } = useReportSummary({ range: "1Y", team: "all" });
  const teams = data?.filters?.teams || [];
  const allAgents = data?.filters?.agents || [];

  useEffect(() => {
    if (!individualAgent && allAgents.length) setIndividualAgent(allAgents[0]);
  }, [allAgents, individualAgent]);

  const numberSelected = searched && !searched.notFound;

  const runSearch = async () => {
    const key = input.replace(/\s+/g, "");
    if (!key) return;
    setSearching(true);
    const res = await request.get({ entity: `report/number-lookup?phone=${encodeURIComponent(key)}` });
    setSearching(false);
    setSearched(res?.success && res.result ? { key, ...res.result } : { key, notFound: true });
    setPage(1);
  };

  const clearSearch = () => {
    setInput("");
    setSearched(null);
    setPage(1);
  };

  const loadBrowsePage = async (targetPage) => {
    setBrowseLoading(true);
    const options = { page: targetPage, items: 10, range };
    if (mode === "individual" && individualAgent) options.calledBy = individualAgent;
    else if (teamFilter !== "all") options.team = teamFilter;
    if (statusFilter !== "All") options.status = statusFilter;
    const res = await request.list({ entity: "call", options });
    if (res?.success !== false) {
      setBrowseCalls(res.result || []);
      setPage(res.pagination?.page || 1);
      setPages(res.pagination?.pages || 1);
      setCount(res.pagination?.count || 0);
    } else {
      setBrowseCalls([]);
    }
    setBrowseLoading(false);
  };

  useEffect(() => {
    if (!numberSelected) loadBrowsePage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numberSelected, mode, teamFilter, individualAgent, statusFilter, range]);

  const numberCalls = numberSelected
    ? searched.calls.filter((c) => statusFilter === "All" || c.status === statusFilter)
    : [];

  const rows = numberSelected
    ? numberCalls
    : browseCalls;

  const totalCalls = numberSelected ? numberCalls.length : count;
  const connectedRows = rows.filter((c) => c.status === "Connected");
  const totalSeconds = connectedRows.reduce((sum, c) => sum + (c.duration || 0), 0);
  const avgSeconds = connectedRows.length ? Math.round(totalSeconds / connectedRows.length) : 0;

  const scopeLabel = mode === "individual" ? individualAgent : teamFilter === "all" ? "All Teams" : teamFilter;

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Look Up a Number</h3>
        </div>

        <div className="hub-row" style={{ gap: 10, flexWrap: "wrap" }}>
          <input
            className="hub-input"
            style={{ minWidth: 220, flex: 1 }}
            placeholder="Enter phone number, e.g. +91 98765 43210"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
          <button type="button" className="hub-btn hub-btn-primary" onClick={runSearch} disabled={searching}>
            <SearchOutlined /> {searching ? "Searching…" : "Search"}
          </button>
          {searched && (
            <button type="button" className="hub-btn" onClick={clearSearch}>
              Clear · Browse by Team/Individual
            </button>
          )}
        </div>
      </div>

      {searched?.notFound && (
        <div className="hub-card">
          <div className="hub-empty">No call history found for {searched.key}.</div>
        </div>
      )}

      {!searched?.notFound && (
        <>
          <div className="hub-card">
            <div className="hub-card-header">
              <h3>{numberSelected ? `Call History — ${searched.key}` : `Call Activity — ${scopeLabel}`}</h3>

              <div className="hub-row" style={{ gap: 10, flexWrap: "wrap" }}>
                <div className="hub-pill-filter">
                  <button
                    type="button"
                    className={`hub-pill-btn ${mode === "team" ? "active" : ""}`}
                    onClick={() => { setMode("team"); setPage(1); }}
                  >
                    <TeamOutlined /> Team
                  </button>
                  <button
                    type="button"
                    className={`hub-pill-btn ${mode === "individual" ? "active" : ""}`}
                    onClick={() => { setMode("individual"); setPage(1); }}
                  >
                    <UserOutlined /> Individual
                  </button>
                </div>

                {mode === "team" ? (
                  <select className="hub-select" value={teamFilter} onChange={(e) => { setTeamFilter(e.target.value); setPage(1); }}>
                    <option value="all">All Teams</option>
                    {teams.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                ) : (
                  <select className="hub-select" value={individualAgent} onChange={(e) => { setIndividualAgent(e.target.value); setPage(1); }}>
                    {allAgents.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                )}

                <select className="hub-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                  {["All", "Connected", "Missed", "No Answer", "Busy", "Voicemail"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>

                <select className="hub-select" value={range} onChange={(e) => { setRange(e.target.value); setPage(1); }}>
                  {REPORT_RANGE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{REPORT_RANGE_LABEL[r]}</option>
                  ))}
                </select>

                <button
                  type="button"
                  className="hub-btn hub-btn-primary"
                  onClick={() =>
                    downloadCsv(
                      `call-history-${numberSelected ? searched.key : "all-numbers"}-${mode}.csv`,
                      [
                        ["Number", "Contact", "Date", "Agent", "Team", "Duration", "Status"],
                        ...rows.map((c) => [c.phone || searched?.key, c.contactName, c.created, c.calledBy, c.team, c.duration, c.status]),
                      ]
                    )
                  }
                >
                  <DownloadOutlined /> Download
                </button>
              </div>
            </div>
          </div>

          <div className="hub-kpi-row">
            {numberSelected && (
              <div className="hub-kpi">
                <div className="hub-kpi-label">Contact</div>
                <div className="hub-kpi-value" style={{ fontSize: 16 }}>{searched.contactName || "—"}</div>
              </div>
            )}
            <div className="hub-kpi">
              <div className="hub-kpi-label">Total Calls</div>
              <div className="hub-kpi-value">{totalCalls}</div>
            </div>
            <div className="hub-kpi">
              <div className="hub-kpi-label">Total Talk Time</div>
              <div className="hub-kpi-value">{fmtMinutesToHm(Math.round(totalSeconds / 60))}</div>
            </div>
            <div className="hub-kpi">
              <div className="hub-kpi-label">Avg / Call</div>
              <div className="hub-kpi-value">{avgSeconds ? fmtSecToMs(avgSeconds) : "—"}</div>
            </div>
          </div>

          <div className="hub-card">
            <div className="hub-table-wrapper">
              <table className="hub-table">
                <thead>
                  <tr>
                    {!numberSelected && <th>Number</th>}
                    {!numberSelected && <th>Contact</th>}
                    <th>Date</th>
                    <th>Agent</th>
                    <th>Team</th>
                    <th>Duration</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {!browseLoading && rows.length === 0 && (
                    <tr>
                      <td colSpan={numberSelected ? 5 : 7}>
                        <div className="hub-empty">No calls match this filter.</div>
                      </td>
                    </tr>
                  )}
                  {(numberSelected ? rows : rows).map((c, idx) => (
                    <tr key={c._id || idx}>
                      {!numberSelected && <td>{c.phone}</td>}
                      {!numberSelected && <td>{c.contactName}</td>}
                      <td>{new Date(c.created).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                      <td>{c.calledBy}</td>
                      <td>{c.team}</td>
                      <td>{fmtSecToMs(c.duration || 0)}</td>
                      <td>
                        <span className={`hub-badge ${CALL_STATUS_BADGE[c.status]}`}>{c.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!numberSelected && pages > 1 && (
              <div className="hub-row" style={{ justifyContent: "center", gap: 12, marginTop: 16, alignItems: "center" }}>
                <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => loadBrowsePage(page - 1)}>Previous</button>
                <span style={{ fontSize: 12.5, color: "var(--hub-muted)" }}>Page {page} of {pages} · {count} calls</span>
                <button type="button" className="hub-btn" disabled={page >= pages} onClick={() => loadBrowsePage(page + 1)}>Next</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   360° OVERVIEW
========================================================= */

// Maps every sidebar tab to the metric shown in the 360° module snapshot.
// Modules marked teamWide aren't attributable to a single agent (e.g.
// Settings, Leads — Lead has no individual owner, see reportController/
// summary.js), so Individual mode shows a "Team-wide" badge instead of a
// number, and modules with no real backing data yet (Payment Mode) show
// "—" rather than a fabricated figure. Quote isn't listed at all — it's
// not a module this app builds.
const REPORT_MODULES = [
  { key: "dashboard", label: "Dashboard", icon: DashboardOutlined },
  { key: "customer", label: "Customers", icon: CustomerServiceOutlined },
  { key: "calls", label: "Calls", icon: PhoneOutlined },
  { key: "performance", label: "Performance", icon: TrophyOutlined },
  { key: "leads", label: "Leads", icon: SolutionOutlined, teamWide: true },
  { key: "invoice", label: "Invoices", icon: ContainerOutlined },
  { key: "payment", label: "Payments", icon: CreditCardOutlined },
  { key: "paymentMode", label: "Payment Mode", icon: WalletOutlined, teamWide: true },
  { key: "taxes", label: "Taxes", icon: ShopOutlined },
  { key: "reports", label: "Reports", icon: BarChartOutlined, teamWide: true },
  { key: "user-management", label: "User Management", icon: TeamOutlined, teamWide: true },
  { key: "communication", label: "Communication", icon: MessageOutlined },
  { key: "generalSettings", label: "Settings", icon: SettingOutlined, teamWide: true },
  { key: "about", label: "About", icon: ReconciliationOutlined, teamWide: true },
];

function getModuleValue(mod, { mode, agent, kpiSource, agentCount }) {
  switch (mod.key) {
    case "dashboard":
      return `${(kpiSource.calls + kpiSource.deals).toLocaleString()} activities`;
    case "customer":
      return `${kpiSource.customers.toLocaleString()} new`;
    case "calls":
      return kpiSource.calls.toLocaleString();
    case "performance":
      return `${kpiSource.connectRatePct}%`;
    case "leads":
      return kpiSource.leads.toLocaleString();
    case "invoice":
      return `${kpiSource.invoices.toLocaleString()} raised`;
    case "payment":
      return fmtInr(kpiSource.revenue);
    case "paymentMode":
      return "—";
    case "taxes":
      return fmtInr(kpiSource.taxCollected);
    case "reports":
      return "Live";
    case "user-management":
      return mode === "team" ? `${agentCount} members` : "1 of " + agentCount;
    case "communication":
      return `${kpiSource.messages.toLocaleString()} sent`;
    case "generalSettings":
      return "Configured";
    case "about":
      return "v1.0";
    default:
      return "—";
  }
}

function Overview360() {
  const [range, setRange] = useState("1M");
  const [mode, setMode] = useState("team");
  const [teamFilter, setTeamFilter] = useState("all");
  const [selectedAgent, setSelectedAgent] = useState("");

  const { data, loading } = useReportSummary({ range, team: teamFilter });
  const filteredAgents = data?.agents || [];
  const totals = data?.totals || { calls: 0, connected: 0, connectRatePct: 0, talkMinutes: 0, customers: 0, deals: 0, revenue: 0, invoices: 0, taxCollected: 0, messages: 0, leads: 0 };
  const teams = data?.filters?.teams || [];

  useEffect(() => {
    if (filteredAgents.length && !filteredAgents.some((a) => a.name === selectedAgent)) {
      setSelectedAgent(filteredAgents[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredAgents]);

  const agent = filteredAgents.find((a) => a.name === selectedAgent) ?? filteredAgents[0];

  // Each team's own separate report — used for the "All Teams" comparison
  // table. One /report/summary call per team, scoped server-side exactly
  // like the main call above.
  const [teamsSummary, setTeamsSummary] = useState([]);
  useEffect(() => {
    if (teamFilter !== "all" || teams.length === 0) { setTeamsSummary([]); return; }
    let alive = true;
    Promise.all(teams.map((t) => fetchReportSummary({ range, team: t }).then((d) => ({ label: t, key: t, members: d?.agents?.length || 0, ...(d?.totals || {}) })))).then((rows) => {
      if (alive) setTeamsSummary(rows);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamFilter, teams.join(","), range]);

  const kpiSource = mode === "team" ? totals : (agent || totals);
  const rows = mode === "team" ? filteredAgents : (agent ? [agent] : []);
  const moduleCtx = { mode, agent, kpiSource, agentCount: filteredAgents.length };
  const showAllTeamsReport = mode === "team" && teamFilter === "all";
  const scopeLabel = mode === "team" ? (teamFilter === "all" ? "All Teams" : teamFilter) : agent?.name;

  const handleDownload = () => {
    if (showAllTeamsReport) {
      const header = ["Team", "Members", "Calls", "Customers", "Invoices", "Deals Closed", "Revenue", "Tax", "Messages", "Connect Rate"];
      downloadCsv(
        `360-report-all-teams-${range}.csv`,
        [header, ...teamsSummary.map((t) => [t.label, t.members, t.calls, t.customers, t.invoices, t.deals, t.revenue, t.taxCollected, t.messages, `${t.connectRatePct}%`])]
      );
      return;
    }

    const header = ["Agent", "Team", "Calls", "Customers", "Invoices", "Deals Closed", "Revenue", "Tax", "Messages", "Connect Rate"];
    downloadCsv(
      `360-report-${mode}-${teamFilter}-${range}.csv`,
      [header, ...rows.map((a) => [a.name, a.team, a.calls, a.customers, a.invoices, a.deals, a.revenue, a.taxCollected, a.messages, `${a.connectRatePct}%`])]
    );
  };

  if (loading && !data) {
    return <div className="hub-card"><div className="hub-empty">Loading report…</div></div>;
  }

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>360° Report — Team &amp; Individual</h3>

          <div className="hub-row" style={{ gap: 14 }}>
            <div className="hub-pill-filter">
              <button type="button" className={`hub-pill-btn ${mode === "team" ? "active" : ""}`} onClick={() => setMode("team")}>
                <TeamOutlined /> Team
              </button>
              <button type="button" className={`hub-pill-btn ${mode === "individual" ? "active" : ""}`} onClick={() => setMode("individual")}>
                <UserOutlined /> Individual
              </button>
            </div>

            <select className="hub-select" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="all">All Teams</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            {mode === "individual" && (
              <select className="hub-select" value={agent?.name ?? ""} onChange={(e) => setSelectedAgent(e.target.value)}>
                {filteredAgents.map((a) => <option key={a.name} value={a.name}>{a.name} · {a.team}</option>)}
              </select>
            )}

            <select className="hub-select" value={range} onChange={(e) => setRange(e.target.value)}>
              {REPORT_RANGE_OPTIONS.map((r) => <option key={r} value={r}>{REPORT_RANGE_LABEL[r]}</option>)}
            </select>

            <button type="button" className="hub-btn hub-btn-primary" onClick={handleDownload}>
              <DownloadOutlined /> Download Report
            </button>
          </div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>All Modules — 360° Snapshot</h3>
          <span className="hub-badge hub-badge-blue">{scopeLabel}</span>
        </div>

        <div className="hub-kpi-row" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
          {REPORT_MODULES.map((mod) => {
            const Icon = mod.icon;
            const showTeamWideBadge = mod.teamWide && mode === "individual";
            return (
              <div className="hub-kpi" key={mod.key}>
                <div className="hub-kpi-label">
                  <Icon style={{ marginRight: 6 }} />
                  {mod.label}
                </div>
                <div className="hub-kpi-value" style={{ fontSize: 17 }}>
                  {getModuleValue(mod, moduleCtx)}
                </div>
                {showTeamWideBadge && (
                  <div className="hub-kpi-delta">
                    <span className="hub-badge hub-badge-gray">Team-wide</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showAllTeamsReport && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>Team-wise Report — Each Team Separately</h3>
            <span className="hub-badge hub-badge-blue">{REPORT_RANGE_LABEL[range]}</span>
          </div>

          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Members</th>
                  <th>Calls</th>
                  <th>Leads</th>
                  <th>Customers</th>
                  <th>Invoices</th>
                  <th>Deals Closed</th>
                  <th>Revenue</th>
                  <th>Messages</th>
                  <th>Connect Rate</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {teamsSummary.length === 0 && (
                  <tr><td colSpan={11}><div className="hub-empty">Loading team breakdown…</div></td></tr>
                )}
                {teamsSummary.map((t) => (
                  <tr key={t.key}>
                    <td>{t.label}</td>
                    <td>{t.members}</td>
                    <td>{(t.calls || 0).toLocaleString()}</td>
                    <td>{(t.leads || 0).toLocaleString()}</td>
                    <td>{(t.customers || 0).toLocaleString()}</td>
                    <td>{(t.invoices || 0).toLocaleString()}</td>
                    <td>{(t.deals || 0).toLocaleString()}</td>
                    <td>{fmtInr(t.revenue)}</td>
                    <td>{(t.messages || 0).toLocaleString()}</td>
                    <td>
                      <span className={`hub-badge ${(t.connectRatePct || 0) >= 80 ? "hub-badge-green" : (t.connectRatePct || 0) >= 60 ? "hub-badge-yellow" : "hub-badge-red"}`}>
                        {t.connectRatePct || 0}%
                      </span>
                    </td>
                    <td>
                      <button type="button" className="hub-btn" onClick={() => setTeamFilter(t.key)}>View Report</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label">Total Calls</div>
          <div className="hub-kpi-value">{kpiSource.calls.toLocaleString()}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Leads Generated</div>
          <div className="hub-kpi-value">{totals.leads.toLocaleString()}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Deals Closed</div>
          <div className="hub-kpi-value">{kpiSource.deals.toLocaleString()}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Revenue{mode === "team" ? " Influenced" : ""}</div>
          <div className="hub-kpi-value">{fmtInr(kpiSource.revenue)}</div>
        </div>
      </div>

      <div className="hub-grid-2">
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>Calls vs Connected — {scopeLabel} — {REPORT_RANGE_LABEL[range]}</h3>
          </div>
          <HubBarChart
            data={filteredAgents.map((a) => ({
              label: a.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
              values: [
                { value: a.calls, color: "#2563EB", tooltip: `${a.name}: ${a.calls} calls` },
                { value: a.connected, color: "#13C2C2", tooltip: `${a.name}: ${a.connected} connected` },
              ],
            }))}
          />
          <HubBarChartLabels labels={filteredAgents.map((a) => a.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase())} />
        </div>

        <div className="hub-card">
          <div className="hub-card-header">
            <h3>{mode === "team" ? "Revenue by Agent" : `${agent?.name} — Connect Rate`}</h3>
          </div>
          <HubDonut
            centerLabel={mode === "team" ? "Revenue" : "Rate"}
            segments={
              mode === "team"
                ? filteredAgents.map((a) => ({ label: a.name.split(" ")[0], value: a.revenue, color: a.color }))
                : agent
                ? [
                    { label: "Connected", value: agent.connectRatePct, color: agent.color },
                    { label: "Remaining", value: 100 - agent.connectRatePct, color: "#eef0f4" },
                  ]
                : []
            }
          />
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>{scopeLabel} — All Tabs Summary</h3>
          <span className="hub-badge hub-badge-blue">{REPORT_RANGE_LABEL[range]}</span>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Team</th>
                <th>Calls</th>
                <th>Customers</th>
                <th>Invoices</th>
                <th>Deals Closed</th>
                <th>Revenue</th>
                <th>Messages</th>
                <th>Connect Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9}><div className="hub-empty">No data for this scope yet.</div></td></tr>
              )}
              {rows.map((a) => (
                <tr key={a.name}>
                  <td>
                    <div className="hub-person">
                      <div className="hub-avatar" style={{ background: a.color }}>
                        {a.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      {a.name}
                    </div>
                  </td>
                  <td>{a.team || "—"}</td>
                  <td>{a.calls.toLocaleString()}</td>
                  <td>{a.customers.toLocaleString()}</td>
                  <td>{a.invoices.toLocaleString()}</td>
                  <td>{a.deals.toLocaleString()}</td>
                  <td>{fmtInr(a.revenue)}</td>
                  <td>{a.messages.toLocaleString()}</td>
                  <td>
                    <span className={`hub-badge ${a.connectRatePct >= 80 ? "hub-badge-green" : a.connectRatePct >= 60 ? "hub-badge-yellow" : "hub-badge-red"}`}>
                      {a.connectRatePct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Shared Team/Individual + team filter toolbar
========================================================= */

function ScopeToolbar({ mode, setMode, teamFilter, setTeamFilter, teams, agentOptions, individualAgent, setIndividualAgent, range, setRange, onDownload }) {
  return (
    <div className="hub-row" style={{ gap: 10, flexWrap: "wrap" }}>
      <div className="hub-pill-filter">
        <button type="button" className={`hub-pill-btn ${mode === "team" ? "active" : ""}`} onClick={() => setMode("team")}>
          <TeamOutlined /> Team
        </button>
        <button type="button" className={`hub-pill-btn ${mode === "individual" ? "active" : ""}`} onClick={() => setMode("individual")}>
          <UserOutlined /> Individual
        </button>
      </div>

      <select className="hub-select" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
        <option value="all">All Teams</option>
        {teams.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>

      {mode === "individual" && (
        <select className="hub-select" value={individualAgent} onChange={(e) => setIndividualAgent(e.target.value)}>
          {agentOptions.map((a) => <option key={a.name} value={a.name}>{a.name} · {a.team}</option>)}
        </select>
      )}

      {range !== undefined && (
        <select className="hub-select" value={range} onChange={(e) => setRange(e.target.value)}>
          {REPORT_RANGE_OPTIONS.map((r) => <option key={r} value={r}>{REPORT_RANGE_LABEL[r]}</option>)}
        </select>
      )}

      {onDownload && (
        <button type="button" className="hub-btn hub-btn-primary" onClick={onDownload}>
          <DownloadOutlined /> Download
        </button>
      )}
    </div>
  );
}

/* =========================================================
   TALK TIME REPORT
========================================================= */

function TalkTimeReport() {
  const [range, setRange] = useState("1M");
  const [mode, setMode] = useState("team");
  const [teamFilter, setTeamFilter] = useState("all");
  const [individualAgent, setIndividualAgent] = useState("");

  const { data, loading } = useReportSummary({ range, team: teamFilter });
  const teamScoped = data?.agents || [];
  const teams = data?.filters?.teams || [];
  const talkByWeekday = data?.talkByWeekday || [];

  useEffect(() => {
    if (teamScoped.length && !teamScoped.some((a) => a.name === individualAgent)) {
      setIndividualAgent(teamScoped[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamScoped]);

  const rows = mode === "individual" ? teamScoped.filter((a) => a.name === individualAgent) : teamScoped;

  const totalMinutes = rows.reduce((sum, a) => sum + a.talkMinutes, 0);
  const totalCalls = rows.reduce((sum, a) => sum + a.calls, 0);
  const longestSec = rows.length ? Math.max(...rows.map((a) => a.longestCallSec)) : 0;
  const avgPerCallSec = totalCalls ? Math.round((totalMinutes * 60) / totalCalls) : 0;

  const scopeLabel = mode === "individual" ? (rows[0]?.name ?? "—") : teamFilter === "all" ? "All Teams" : teamFilter;

  const handleDownload = () => {
    downloadCsv(
      `talk-time-${mode}-${teamFilter}-${range}.csv`,
      [
        ["Agent", "Team", "Total Calls", "Total Talk Time (min)", "Avg / Call", "Longest Call"],
        ...rows.map((a) => [a.name, a.team, a.calls, a.talkMinutes, fmtSecToMs(avgSecPerCall(a)), fmtSecToMs(a.longestCallSec)]),
      ]
    );
  };

  if (loading && !data) {
    return <div className="hub-card"><div className="hub-empty">Loading talk time report…</div></div>;
  }

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Talk Time Report — {scopeLabel}</h3>
        </div>
        <ScopeToolbar
          mode={mode} setMode={setMode}
          teamFilter={teamFilter} setTeamFilter={setTeamFilter}
          teams={teams}
          agentOptions={teamScoped}
          individualAgent={individualAgent} setIndividualAgent={setIndividualAgent}
          range={range} setRange={setRange}
          onDownload={handleDownload}
        />
      </div>

      <div className="hub-kpi-row">
        <div className="hub-kpi">
          <div className="hub-kpi-label">Total Calls</div>
          <div className="hub-kpi-value">{totalCalls.toLocaleString()}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Total Talk Time</div>
          <div className="hub-kpi-value">{fmtMinutesToHm(totalMinutes)}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Avg / Call</div>
          <div className="hub-kpi-value">{totalCalls ? fmtSecToMs(avgPerCallSec) : "—"}</div>
        </div>
        <div className="hub-kpi">
          <div className="hub-kpi-label">Longest Call</div>
          <div className="hub-kpi-value">{rows.length ? fmtSecToMs(longestSec) : "—"}</div>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Talk Time — {REPORT_RANGE_LABEL[range]}</h3>
          <span className="hub-badge hub-badge-blue">{fmtMinutesToHm(totalMinutes)} total</span>
        </div>
        <HubBarChart
          data={talkByWeekday.map((d) => ({
            label: d.label,
            values: [{ value: d.minutes, color: "#2563EB", tooltip: `${d.minutes} min` }],
          }))}
        />
        <HubBarChartLabels labels={talkByWeekday.map((d) => d.label)} />
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Talk Time by Agent</h3>
        </div>
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Team</th>
                <th>Total Calls</th>
                <th>Total Talk Time</th>
                <th>Avg / Call</th>
                <th>Longest Call</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6}><div className="hub-empty">No calls in this range.</div></td></tr>
              )}
              {rows.map((a) => (
                <tr key={a.name}>
                  <td>
                    <div className="hub-person">
                      <div className="hub-avatar" style={{ background: a.color }}>
                        {a.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      {a.name}
                    </div>
                  </td>
                  <td>{a.team || "—"}</td>
                  <td>{a.calls.toLocaleString()}</td>
                  <td>{fmtMinutesToHm(a.talkMinutes)}</td>
                  <td>{fmtSecToMs(avgSecPerCall(a))}</td>
                  <td>{fmtSecToMs(a.longestCallSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   USER CALL REPORT
========================================================= */

function UserCallReport() {
  const [range, setRange] = useState("1M");
  const [mode, setMode] = useState("team");
  const [teamFilter, setTeamFilter] = useState("all");
  const [individualAgent, setIndividualAgent] = useState("");
  const [query, setQuery] = useState("");

  const { data, loading } = useReportSummary({ range, team: teamFilter });
  const teamScoped = data?.agents || [];
  const teams = data?.filters?.teams || [];

  useEffect(() => {
    if (teamScoped.length && !teamScoped.some((a) => a.name === individualAgent)) {
      setIndividualAgent(teamScoped[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamScoped]);

  const scoped = mode === "individual" ? teamScoped.filter((a) => a.name === individualAgent) : teamScoped;
  const filtered = scoped.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  const handleDownload = () => {
    downloadCsv(
      `user-call-report-${mode}-${teamFilter}-${range}.csv`,
      [
        ["User", "Team", "Total Calls", "Total Time on Calls", "Avg Duration / Call"],
        ...filtered.map((a) => [a.name, a.team, a.calls, fmtMinutesToHm(a.talkMinutes), fmtSecToMs(avgSecPerCall(a))]),
      ]
    );
  };

  if (loading && !data) {
    return <div className="hub-card"><div className="hub-empty">Loading user call report…</div></div>;
  }

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>User Call Report</h3>
          <ScopeToolbar
            mode={mode} setMode={setMode}
            teamFilter={teamFilter} setTeamFilter={setTeamFilter}
            teams={teams}
            agentOptions={teamScoped}
            individualAgent={individualAgent} setIndividualAgent={setIndividualAgent}
            range={range} setRange={setRange}
            onDownload={handleDownload}
          />
        </div>

        {mode === "team" && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agent..."
            className="hub-input"
            style={{ marginTop: 14, maxWidth: 260 }}
          />
        )}
      </div>

      <div className="hub-card">
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Team</th>
                <th>Total Calls</th>
                <th>Total Time on Calls</th>
                <th>Avg Duration / Call</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="hub-empty">No matching users.</div>
                  </td>
                </tr>
              )}
              {filtered.map((a) => (
                <tr key={a.name}>
                  <td>
                    <div className="hub-person">
                      <div className="hub-avatar" style={{ background: a.color }}>
                        {a.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      {a.name}
                    </div>
                  </td>
                  <td>{a.team || "—"}</td>
                  <td>{a.calls.toLocaleString()}</td>
                  <td>{fmtMinutesToHm(a.talkMinutes)}</td>
                  <td>{fmtSecToMs(avgSecPerCall(a))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState("overview");

  return (
    <div className="hub-page">
      <div className="hub-header">
        <div>
          <h2>Advanced Reporting</h2>
          <p>A 360° view of calls, leads, and team activity — plus detailed talk-time breakdowns</p>
        </div>
      </div>

      <HubTabs
        tabs={[
          { key: "overview", label: "360° Overview" },
          { key: "talktime", label: "Talk Time Report" },
          { key: "usercalls", label: "User Call Report" },
          { key: "lookup", label: "Number Lookup" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "overview" && <Overview360 />}
      {tab === "talktime" && <TalkTimeReport />}
      {tab === "usercalls" && <UserCallReport />}
      {tab === "lookup" && <NumberLookup />}
    </div>
  );
}
