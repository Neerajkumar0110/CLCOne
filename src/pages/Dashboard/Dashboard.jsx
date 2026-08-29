import React, { useEffect, useState } from "react";
import "./Dashboard.css";
import NewTicketModal from "@/components/NewTicketModal";
import HubModal from "@/components/HubModal";
import LineAreaChart from "@/components/charts/LineAreaChart";
import DonutChart from "@/components/charts/DonutChart";
import { useTickets } from "@/context/ticketsContext";
import { useSelector } from "react-redux";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { request } from "@/request";

// Same status/priority color mapping as the Support page (pages/Support).
const TICKET_STATUS_META = {
  Open: "hub-badge-red",
  "In Progress": "hub-badge-yellow",
  Resolved: "hub-badge-green",
};

const TICKET_PRIORITY_META = {
  Low: "hub-badge-gray",
  Medium: "hub-badge-blue",
  High: "hub-badge-yellow",
  Urgent: "hub-badge-red",
};

const RANGE_OPTIONS = ["1M", "3M", "6M", "1Y"];

const RANGE_LABEL = {
  "1M": "Last 1 Month",
  "3M": "Last 3 Months",
  "6M": "Last 6 Months",
  "1Y": "Last 1 Year",
};

const ALL_TEAMS = "__all_teams__";
const ALL_AGENTS = "__all_agents__";

// Fixed categorical order, validated for CVD-safety with
// dataviz/scripts/validate_palette.js (all checks pass, light + dark).
const OUTCOME_COLORS = {
  Connected: "#2563eb",
  Missed: "#e11d48",
  "No Answer": "#d97706",
  Busy: "#0891b2",
  Voicemail: "#7c3aed",
};

const CALLS_SERIES = [
  { key: "connected", label: "Connected", color: "#2563eb" },
  { key: "missed", label: "Missed", color: "#e11d48" },
];

function statusFor(connectRatePct) {
  if (connectRatePct >= 70) return { label: "Excellent", className: "status-good" };
  if (connectRatePct >= 40) return { label: "Average", className: "status-mid" };
  return { label: "Needs Work", className: "status-low" };
}

function RangeFilter({ value, onChange, size = "md" }) {
  return (
    <div className={`range-filter ${size === "sm" ? "range-filter-sm" : ""}`}>
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`range-filter-btn ${value === opt ? "active" : ""}`}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function Icon({ type }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
  };

  if (type === "phone") {
    return (
      <svg {...common}>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    );
  }

  if (type === "check") {
    return (
      <svg {...common}>
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }

  if (type === "close") {
    return (
      <svg {...common}>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    );
  }

  if (type === "clock") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M12 20V10M18 20V4M6 20v-4" />
    </svg>
  );
}

// Ambient "rising embers" background — a handful of small glowing dots
// drifting upward behind the card content. Purely decorative (aria-hidden,
// no pointer events) and kept low-opacity so it never competes with the data.
function Embers() {
  return (
    <div className="embers" aria-hidden="true">
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className="ember" />
      ))}
    </div>
  );
}

function KpiCard({ icon, iconClass, label, value, context }) {
  return (
    <div className="kpi-card">
      <Embers />
      <div className="kpi-card-content">
        <div className="kpi-icon-wrapper">
          <div className={`kpi-icon ${iconClass}`}>
            <Icon type={icon} />
          </div>
        </div>

        <div className="kpi-label">{label}</div>

        <div className="kpi-value">{value}</div>

        <div className="kpi-delta">{context}</div>
      </div>
    </div>
  );
}

function Panel({ children, className = "" }) {
  return (
    <div className={`panel ${className}`}>
      <Embers />
      <div className="panel-content">{children}</div>
    </div>
  );
}

function PanelHeader({ title, tag, right }) {
  return (
    <div className="panel-header">
      <h3>{title}</h3>

      <div className="panel-header-right">
        {tag && <span className="panel-tag">{tag}</span>}
        {right}
      </div>
    </div>
  );
}


export default function Dashboard() {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const [range, setRange] = useState("1M");
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [agentFilter, setAgentFilter] = useState(ALL_AGENTS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [myTicketsOpen, setMyTicketsOpen] = useState(false);
  const { tickets, addTicket } = useTickets();

  const myTickets = tickets.filter((t) => t.createdBy === currentAdmin?._id);
  const myOpenTicketsCount = myTickets.filter((t) => t.status !== "Resolved").length;

  const loadDashboard = async () => {
    setLoading(true);
    const options = { range };
    if (teamFilter !== ALL_TEAMS) options.team = teamFilter;
    if (agentFilter !== ALL_AGENTS) options.agent = agentFilter;
    const res = await request.get({ entity: "dashboard/summary?" + new URLSearchParams(options).toString() });
    setData(res?.success ? res.result : null);
    setLoading(false);
  };

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, teamFilter, agentFilter]);

  const isManagement = data?.scope?.isManagement;
  const kpis = data?.kpis;
  const agents = data?.agents || [];
  const topPerformer = data?.topPerformer;

  return (
    <div className="dashboard">
      <main className="dashboard-content">
        {/* TOOLBAR */}
        <div className="dashboard-toolbar">
          <div>
            <h2>Dashboard Overview</h2>
            <div className="dashboard-toolbar-sub">
              {isManagement
                ? "Company-wide — filter by team or by one person below"
                : `Your data${data?.scope?.team ? ` and ${data.scope.team}'s` : ""}`}
            </div>
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
            <RangeFilter value={range} onChange={setRange} />
            <button type="button" className="hub-btn" onClick={() => setMyTicketsOpen(true)}>
              My Tickets{myOpenTicketsCount > 0 && (
                <span className="hub-badge hub-badge-red" style={{ marginLeft: 8 }}>{myOpenTicketsCount}</span>
              )}
            </button>
            <button type="button" className="hub-btn hub-btn-primary" onClick={() => setTicketOpen(true)}>
              + Raise Ticket
            </button>
          </div>
        </div>

        <NewTicketModal open={ticketOpen} onClose={() => setTicketOpen(false)} onAdd={addTicket} />

        <HubModal
          open={myTicketsOpen}
          onClose={() => setMyTicketsOpen(false)}
          title="My Tickets"
          subtitle="Every ticket you've raised, and whether it's been resolved"
          width={620}
        >
          {myTickets.length === 0 ? (
            <div className="hub-empty">You haven't raised any tickets yet.</div>
          ) : (
            <div className="hub-table-wrapper">
              <table className="hub-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Subject</th>
                    <th>Category</th>
                    <th>Priority</th>
                    <th>Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {myTickets.map((t) => (
                    <tr key={t.id}>
                      <td>{t.code}</td>
                      <td>{t.subject}</td>
                      <td>{t.category}</td>
                      <td>
                        <span className={`hub-badge ${TICKET_PRIORITY_META[t.priority]}`}>{t.priority}</span>
                      </td>
                      <td>{t.date}</td>
                      <td>
                        <span className={`hub-badge ${TICKET_STATUS_META[t.status]}`}>{t.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </HubModal>

        {!kpis ? (
          <div className="hub-card">
            <div className="hub-empty">Loading dashboard…</div>
          </div>
        ) : (
          <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s ease" }}>
            {/* KPI CARDS */}
            <div className="kpi-grid">
              <KpiCard
                icon="phone"
                iconClass="blue"
                label="Total Calls"
                value={kpis.totalCalls.toLocaleString()}
                context={RANGE_LABEL[range]}
              />

              <KpiCard
                icon="check"
                iconClass="green"
                label="Connected Calls"
                value={kpis.connected.toLocaleString()}
                context={`${kpis.connectRatePct}% connect rate`}
              />

              <KpiCard
                icon="close"
                iconClass="red"
                label="Missed / No Answer"
                value={kpis.missed.toLocaleString()}
                context={RANGE_LABEL[range]}
              />

              <KpiCard
                icon="clock"
                iconClass="yellow"
                label="Average Call Duration"
                value={kpis.avgDurationLabel}
                context="minutes:seconds"
              />

              <KpiCard
                icon="chart"
                iconClass="purple"
                label="Lead Conversion Rate"
                value={`${kpis.conversionRatePct}%`}
                context={`${kpis.wonLeads} won of ${kpis.totalLeads} leads`}
              />
            </div>

            {/* CHARTS */}
            <div className="charts-grid">
              <Panel>
                <PanelHeader title="Calls — Connected vs Missed" tag={RANGE_LABEL[range]} />
                <LineAreaChart data={data.callsOverTime} seriesKeys={CALLS_SERIES} xKey="label" />
              </Panel>

              <Panel>
                <PanelHeader title="Call Outcome Breakdown" tag={RANGE_LABEL[range]} />
                <DonutChart
                  segments={Object.entries(data.outcome).map(([key, value]) => ({
                    key,
                    value,
                    color: OUTCOME_COLORS[key] || "#8C8C8C",
                  }))}
                />
              </Panel>
            </div>

            {/* AGENT TABLE */}
            <Panel className="agent-panel">
              <PanelHeader
                title={isManagement ? "Call Performance — Everyone in Scope" : "Call Performance — My Team"}
                tag={`${agents.length} ${agents.length === 1 ? "person" : "people"} · ${RANGE_LABEL[range]}`}
              />

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Calls Made</th>
                      <th>Connected</th>
                      <th>Connect Rate</th>
                      <th>Average Duration</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {agents.length === 0 && (
                      <tr>
                        <td colSpan={6}>
                          <div className="hub-empty">No calls logged in this period.</div>
                        </td>
                      </tr>
                    )}
                    {agents.map((agent) => {
                      const status = statusFor(agent.connectRatePct);
                      const isMe = agent.name === currentAdmin?.name;
                      return (
                        <tr key={agent.name}>
                          <td>
                            <div className="agent">
                              <div className="agent-avatar" style={{ backgroundColor: "#2563EB" }}>
                                {agent.name.slice(0, 2).toUpperCase()}
                              </div>
                              {agent.name}
                              {isMe && <span className="hub-badge hub-badge-blue" style={{ marginLeft: 8 }}>You</span>}
                            </div>
                          </td>

                          <td>{agent.calls.toLocaleString()}</td>
                          <td>{agent.connected.toLocaleString()}</td>

                          <td>
                            <div className="rate">
                              <div className="rate-track">
                                <div className="rate-fill" style={{ width: `${agent.connectRatePct}%`, backgroundColor: "#2563EB" }} />
                              </div>
                              <span>{agent.connectRatePct}%</span>
                            </div>
                          </td>

                          <td>{agent.avgDurationLabel}</td>

                          <td>
                            <span className={`status-badge ${status.className}`}>{status.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* BOTTOM SECTION */}
            <div className="bottom-grid">
              {/* CALL STATUS TODAY */}
              <Panel>
                <PanelHeader title="Call Status — Today (Live)" />

                {Object.entries(data.callStatusToday).map(([label, count]) => (
                  <div className="status-row" key={label}>
                    <div className="status-left">
                      <span className="status-dot" style={{ backgroundColor: OUTCOME_COLORS[label] || "#8C8C8C" }} />
                      {label}
                    </div>
                    <strong>{count}</strong>
                  </div>
                ))}
              </Panel>

              {/* TOP PERFORMER */}
              <Panel>
                <PanelHeader title="Top Performer" tag={RANGE_LABEL[range]} />

                {topPerformer ? (
                  <>
                    <div className="performer">
                      <div className="performer-avatar">{topPerformer.name.slice(0, 2).toUpperCase()}</div>

                      <div>
                        <div className="performer-name">{topPerformer.name}</div>
                        <div className="performer-meta">
                          {topPerformer.calls.toLocaleString()} calls • {topPerformer.connectRatePct}% connect rate
                        </div>
                      </div>
                    </div>

                    <div className="performer-info">
                      📞 Most calls made in this period
                      <br />
                      ⏱ Average call duration: {topPerformer.avgDurationLabel} min
                    </div>
                  </>
                ) : (
                  <div className="hub-empty">No calls logged in this period.</div>
                )}
              </Panel>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
