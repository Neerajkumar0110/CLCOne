import React, { useMemo, useState } from "react";
import { message } from "antd";
import { request } from "@/request";
import { usePoll } from "@/pages/Calling/shared";
import { stageConfig } from "@/config/leadStages";
import "./TeamActivity.css";

// Lead Management → "Team Activity" (management only — backend
// callingController/teamActivity.js enforces it). Every Sales user with
// their live Instant Lead Pool state (switch them on/off from here), today's
// hours and calls, and a 7-day day-by-day breakdown. Click a row for the
// full profile.
//   Login hours  → real app time (LoginActivity), available for all 7 days
//   Pool time    → time in the Instant Lead Pool, today only

const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#4f46e5", "#ca8a04"];
const POOL_STATUS = {
  Available: { label: "Waiting for call", color: "#16a34a" },
  Ringing: { label: "Ringing", color: "#2563eb" },
  OnCall: { label: "On a call", color: "#2563eb" },
  Wrapup: { label: "Wrap-up", color: "#7c3aed" },
  Paused: { label: "On break", color: "#d97706" },
};

function hm(seconds) {
  const m = Math.round((seconds || 0) / 60);
  if (m <= 0) return "0m";
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || "")
    .join("")
    .toUpperCase();
}
function colorFor(id) {
  const s = String(id || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function dayLabel(key, todayKey) {
  if (key === todayKey) return "Today";
  const d = new Date(`${key}T12:00:00+05:30`);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}
function ago(v) {
  if (!v) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className="ta-kpi" style={{ "--ta-accent": accent }}>
      <div className="ta-kpi-label">{label}</div>
      <div className="ta-kpi-value">{value}</div>
      {sub && <div className="ta-kpi-sub">{sub}</div>}
    </div>
  );
}

function Avatar({ u }) {
  return (
    <div
      className="ta-avatar"
      style={u.photo ? { backgroundImage: `url(${u.photo})` } : { background: colorFor(u._id) }}
    >
      {!u.photo && initials(u.name)}
      <span className={`ta-dot ${u.online ? "on" : ""}`} title={u.online ? "Online now" : "Offline"} />
    </div>
  );
}

function WeekBars({ days, todayKey }) {
  const max = Math.max(3600, ...days.map((d) => d.loginSeconds));
  return (
    <div className="ta-bars" title="Login hours, last 7 days">
      {days.map((d) => (
        <div
          key={d.day}
          className={`ta-bar ${d.day === todayKey ? "today" : ""} ${d.loginSeconds ? "" : "zero"}`}
          style={{ height: `${Math.max(7, (d.loginSeconds / max) * 100)}%` }}
          title={`${dayLabel(d.day, todayKey)} — ${hm(d.loginSeconds)} logged in, ${d.calls} calls`}
        />
      ))}
    </div>
  );
}

function Detail({ u, todayKey }) {
  const stages = Object.entries(u.leads.byStage).sort((a, b) => b[1] - a[1]);
  const st = POOL_STATUS[u.pool.status];
  return (
    <div className="ta-detail-inner">
      <div>
        <div className="ta-section-title">Profile</div>
        <dl className="ta-facts">
          <dt>Email</dt><dd>{u.email || "—"}</dd>
          <dt>Phone</dt><dd>{u.phone || <span style={{ color: "#dc2626" }}>Not set — can't join the pool</span>}</dd>
          <dt>Role</dt><dd>{u.role}</dd>
          <dt>Team</dt>
          <dd>{u.teams.length ? u.teams.map((t) => `${t.name}${t.isLead ? " (Lead)" : ""}`).join(", ") : "—"}</dd>
          <dt>Business</dt><dd>{[u.businessName, u.businessSegment].filter(Boolean).join(" · ") || "—"}</dd>
          <dt>Joined CRM</dt><dd>{u.joined ? new Date(u.joined).toLocaleDateString("en-IN") : "—"}</dd>
          <dt>Last seen</dt><dd>{u.online ? "Online now" : ago(u.lastSeenAt)}</dd>
          <dt>Lead Pool</dt>
          <dd>
            {u.pool.on ? (st ? st.label : u.pool.status) : "Not in pool"}
            {u.pool.on && u.pool.since ? ` · since ${new Date(u.pool.since).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
          </dd>
          <dt>Breaks today</dt>
          <dd>{u.pool.breakMinutesToday ? `${u.pool.breakMinutesToday}m (${u.pool.breaksTakenToday.join(", ")})` : "None"}</dd>
        </dl>
      </div>

      <div>
        <div className="ta-section-title">Last 7 days</div>
        <table className="ta-week">
          <thead>
            <tr><th>Day</th><th>Logged in</th><th>Calls</th><th>Connected</th><th>Talk time</th></tr>
          </thead>
          <tbody>
            {[...u.days].reverse().map((d) => (
              <tr key={d.day} className={d.day === todayKey ? "today" : ""}>
                <td>{dayLabel(d.day, todayKey)}</td>
                <td>{hm(d.loginSeconds)}</td>
                <td>{d.calls}</td>
                <td>{d.connected}</td>
                <td>{hm(d.talkSeconds)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total ({u.week.activeDays} active day{u.week.activeDays === 1 ? "" : "s"})</td>
              <td>{hm(u.week.loginSeconds)}</td>
              <td>{u.week.calls}</td>
              <td>{u.week.connected}</td>
              <td>{hm(u.week.talkSeconds)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        <div className="ta-section-title">Assigned leads · {u.leads.total}</div>
        {stages.length ? (
          <div className="ta-chips">
            {stages.map(([stage, n]) => (
              <span key={stage} className="ta-chip">
                <i style={{ background: stageConfig(stage)?.color || "#94a3b8" }} />
                {stage} <b>{n}</b>
              </span>
            ))}
          </div>
        ) : (
          <div className="ta-sub">No leads assigned.</div>
        )}
      </div>
    </div>
  );
}

export default function TeamActivity() {
  const [rows, setRows] = useState(null);
  const [days, setDays] = useState([]);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    const r = await request.get({ entity: "calling/team-activity" });
    if (r?.success) {
      setRows(r.result);
      setDays(r.days || []);
    }
  };
  usePoll(load, 15000, []);

  const todayKey = days[days.length - 1];

  const togglePool = async (u, e) => {
    e.stopPropagation();
    if (busyId) return;
    const on = !u.pool.on;
    if (!on && !window.confirm(`Take ${u.name} out of the Instant Lead Pool? They'll stop receiving calls.`)) return;
    setBusyId(u._id);
    const r = await request.post({ entity: `calling/team-activity/${u._id}/pool`, jsonData: { on } });
    if (r?.success) message.success(r.message);
    else window.alert(r?.message || "Could not change the pool status.");
    await load();
    setBusyId(null);
  };

  const roles = useMemo(() => [...new Set((rows || []).map((u) => u.role))].sort(), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter((u) => {
      if (role && u.role !== role) return false;
      if (filter === "pool" && !u.pool.on) return false;
      if (filter === "nopool" && u.pool.on) return false;
      if (filter === "online" && !u.online) return false;
      if (needle && ![u.name, u.email, u.phone, u.role].some((v) => String(v || "").toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [rows, q, role, filter]);

  const totals = useMemo(() => {
    const all = rows || [];
    const sum = (f) => all.reduce((t, u) => t + f(u), 0);
    const loggedToday = all.filter((u) => u.today.loginSeconds > 0).length;
    return {
      users: all.length,
      inPool: all.filter((u) => u.pool.on).length,
      online: all.filter((u) => u.online).length,
      callsToday: sum((u) => u.today.calls),
      connectedToday: sum((u) => u.today.connected),
      loginToday: sum((u) => u.today.loginSeconds),
      loggedToday,
      weekLogin: sum((u) => u.week.loginSeconds),
    };
  }, [rows]);

  if (!rows) {
    return <div className="hub-card"><div className="hub-empty">Loading team activity…</div></div>;
  }

  return (
    <div className="hub-stack">
      <div className="ta-kpis">
        <Kpi label="Sales users" value={totals.users} sub={`${totals.online} online now`} accent="#2563eb" />
        <Kpi label="In Lead Pool" value={totals.inPool} sub={`${totals.users - totals.inPool} not active`} accent="#16a34a" />
        <Kpi label="Calls today" value={totals.callsToday} sub={`${totals.connectedToday} connected`} accent="#7c3aed" />
        <Kpi
          label="Avg hours today"
          value={hm(totals.loggedToday ? totals.loginToday / totals.loggedToday : 0)}
          sub={`${totals.loggedToday} logged in today`}
          accent="#ea580c"
        />
        <Kpi label="Team hours · 7 days" value={hm(totals.weekLogin)} sub="total logged-in time" accent="#0891b2" />
      </div>

      <div className="hub-card">
        <div className="hub-card-header">
          <h3>Team Activity</h3>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--hub-muted)", marginBottom: 12 }}>
          Every Sales user — switch the Instant Lead Pool on for anyone who isn't active, and see how long they've worked
          today and over the last week. Click a row for full details.
        </div>

        <div className="ta-toolbar">
          <input className="hub-input" placeholder="Search name, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="hub-select" style={{ width: 170 }} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="hub-select" style={{ width: 170 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Everyone</option>
            <option value="pool">In Lead Pool</option>
            <option value="nopool">Not in Lead Pool</option>
            <option value="online">Online now</option>
          </select>
        </div>

        <div className="hub-table-wrapper">
          <table className="hub-table ta-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Lead Pool</th>
                <th>Logged in today</th>
                <th>Pool time today</th>
                <th>Calls today</th>
                <th>Last 7 days</th>
                <th>Week total</th>
                <th>Leads</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={8}><div className="hub-empty">No users match.</div></td></tr>
              )}
              {shown.map((u) => {
                const open = openId === u._id;
                const st = POOL_STATUS[u.pool.status];
                return (
                  <React.Fragment key={u._id}>
                    <tr className={`ta-row ${open ? "open" : ""}`} onClick={() => setOpenId(open ? null : u._id)}>
                      <td>
                        <div className="ta-user">
                          <Avatar u={u} />
                          <div>
                            <div className="ta-name">{u.name}</div>
                            <div className="ta-sub">
                              {u.role}
                              {u.teams.length ? ` · ${u.teams.map((t) => t.name).join(", ")}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="ta-pool">
                          <button
                            type="button"
                            className={`hub-switch ${u.pool.on ? "on" : ""}`}
                            disabled={busyId === u._id}
                            title={u.pool.on ? "Take out of the Lead Pool" : "Switch on — start sending calls"}
                            onClick={(e) => togglePool(u, e)}
                          />
                          <span className="ta-pool-label" style={{ color: u.pool.on ? st?.color || "#16a34a" : "var(--hub-muted)" }}>
                            {busyId === u._id ? "…" : u.pool.on ? st?.label || u.pool.status : "Inactive"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="ta-num">{hm(u.today.loginSeconds)}</div>
                        <div className="ta-sub">{u.online ? "online now" : `seen ${ago(u.lastSeenAt)}`}</div>
                      </td>
                      <td><div className="ta-num">{u.pool.minutesToday ? hm(u.pool.minutesToday * 60) : "—"}</div></td>
                      <td>
                        <div className="ta-num">{u.today.calls}</div>
                        <div className="ta-sub">{u.today.connected} connected</div>
                      </td>
                      <td><WeekBars days={u.days} todayKey={todayKey} /></td>
                      <td>
                        <div className="ta-num">{hm(u.week.loginSeconds)}</div>
                        <div className="ta-sub">{u.week.calls} calls · {u.week.activeDays}d active</div>
                      </td>
                      <td><div className="ta-num">{u.leads.total}</div></td>
                    </tr>
                    {open && (
                      <tr className="ta-detail">
                        <td colSpan={8}><Detail u={u} todayKey={todayKey} /></td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
