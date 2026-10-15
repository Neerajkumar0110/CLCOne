import React, { useEffect, useState } from "react";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import { stageConfig } from "@/config/leadStages";
import { ROLE_DEPARTMENT } from "@/config/roles";
import "@/pages/Leads/TeamActivity.css";

// User Management → click a user row. Everything about one user in one
// place, from GET /api/admin/overview/:id: when they joined, profile, who
// they report to, teams, last 7 days of logins + calls, recent login
// sessions, assigned leads by stage and Instant Lead Pool state.

function hm(seconds) {
  const m = Math.round((seconds || 0) / 60);
  if (m <= 0) return "0m";
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";
}
function fmtDateTime(v) {
  return v
    ? new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })
    : "—";
}
function ago(v) {
  if (!v) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function daysSince(v) {
  if (!v) return null;
  return Math.floor((Date.now() - new Date(v).getTime()) / 86400000);
}
function dayLabel(key, todayKey) {
  if (key === todayKey) return "Today";
  return new Date(`${key}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className="ta-kpi" style={{ "--ta-accent": accent }}>
      <div className="ta-kpi-label">{label}</div>
      <div className="ta-kpi-value" style={{ fontSize: 20 }}>{value}</div>
      {sub && <div className="ta-kpi-sub">{sub}</div>}
    </div>
  );
}

export default function UserDetailModal({ open, userId, color, init, onClose }) {
  const [u, setU] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !userId) return;
    setU(null);
    setError(null);
    request.get({ entity: `admin/overview/${userId}` }).then((r) => {
      if (r?.success) setU(r.result);
      else setError(r?.message || "Could not load this user.");
    });
  }, [open, userId]);

  const todayKey = u?.days?.[u.days.length - 1]?.day;
  const week = (u?.days || []).reduce(
    (t, d) => ({
      login: t.login + d.loginSeconds,
      calls: t.calls + d.calls,
      connected: t.connected + d.connected,
      talk: t.talk + d.talkSeconds,
      active: t.active + (d.loginSeconds > 0 || d.calls > 0 ? 1 : 0),
    }),
    { login: 0, calls: 0, connected: 0, talk: 0, active: 0 }
  );
  const today = u?.days?.find((d) => d.day === todayKey);
  const tenure = daysSince(u?.created);
  const stages = Object.entries(u?.leads?.byStage || {}).sort((a, b) => b[1] - a[1]);

  return (
    <HubModal open={open} onClose={onClose} title="User details" width={980}>
      {!u && !error && <div className="hub-empty">Loading…</div>}
      {error && <div className="hub-empty">{error}</div>}
      {u && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* header */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div
              className="ta-avatar"
              style={{
                width: 56,
                height: 56,
                fontSize: 19,
                ...(u.photo ? { backgroundImage: `url(${u.photo})` } : { background: color || "#2563eb" }),
              }}
            >
              {!u.photo && init}
              <span className={`ta-dot ${u.online ? "on" : ""}`} style={{ width: 14, height: 14 }} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="ta-name" style={{ fontSize: 18 }}>{u.name}</div>
              <div className="ta-sub" style={{ fontSize: 12.5 }}>
                {u.email}
                {u.phone ? ` · ${u.phone}` : ""}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <span className="hub-badge hub-badge-blue">{u.role}{u.subRole ? ` · ${u.subRole}` : ""}</span>
                <span className={`hub-badge ${u.enabled ? "hub-badge-green" : "hub-badge-gray"}`}>
                  {u.enabled ? "Active — can log in" : "Disabled"}
                </span>
                <span className={`hub-badge ${u.online ? "hub-badge-green" : "hub-badge-gray"}`}>
                  {u.online ? "Online now" : `Last seen ${ago(u.lastSeenAt)}`}
                </span>
                {u.pool.on && <span className="hub-badge hub-badge-green">In Lead Pool · {u.pool.status}</span>}
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div className="ta-kpis" style={{ marginBottom: 0 }}>
            <Kpi
              label="Joined on"
              value={fmtDate(u.created)}
              sub={tenure == null ? "" : tenure === 0 ? "joined today" : `${tenure} day${tenure === 1 ? "" : "s"} ago`}
              accent="#2563eb"
            />
            <Kpi label="Logged in today" value={hm(today?.loginSeconds)} sub={`${today?.sessions || 0} session(s)`} accent="#16a34a" />
            <Kpi label="Last 7 days" value={hm(week.login)} sub={`${week.active} active day(s)`} accent="#ea580c" />
            <Kpi label="Calls · 7 days" value={week.calls} sub={`${week.connected} connected · ${u.totalCalls} all-time`} accent="#7c3aed" />
            <Kpi label="Assigned leads" value={u.leads.total} sub={stages[0] ? `most in ${stages[0][0]}` : "none"} accent="#0891b2" />
          </div>

          <div className="ta-detail-inner" style={{ padding: 0, borderBottom: "none" }}>
            <div>
              <div className="ta-section-title">Profile</div>
              <dl className="ta-facts">
                <dt>Joined</dt><dd>{fmtDateTime(u.created)}</dd>
                <dt>Department</dt><dd>{ROLE_DEPARTMENT[u.role] || "—"}</dd>
                <dt>Reports to</dt><dd>{u.reportsTo ? `${u.reportsTo.name} (${u.reportsTo.role})` : "—"}</dd>
                <dt>Team</dt>
                <dd>{u.teams.length ? u.teams.map((t) => `${t.name}${t.isLead ? " (Lead)" : ""}`).join(", ") : "—"}</dd>
                <dt>Business</dt><dd>{[u.businessName, u.businessSegment].filter(Boolean).join(" · ") || "—"}</dd>
                <dt>Phone</dt><dd>{u.phone || "—"}</dd>
                <dt>Last login</dt><dd>{fmtDateTime(u.login.lastLoginAt)}</dd>
                <dt>Total logins</dt><dd>{u.login.totalSessions}</dd>
                <dt>Breaks today</dt><dd>{u.pool.breakMinutesToday ? `${u.pool.breakMinutesToday}m` : "None"}</dd>
              </dl>
            </div>

            <div>
              <div className="ta-section-title">Last 7 days</div>
              <table className="ta-week">
                <thead>
                  <tr><th>Day</th><th>Logged in</th><th>Logins</th><th>Calls</th><th>Connected</th><th>Talk</th></tr>
                </thead>
                <tbody>
                  {[...u.days].reverse().map((d) => (
                    <tr key={d.day} className={d.day === todayKey ? "today" : ""}>
                      <td>{dayLabel(d.day, todayKey)}</td>
                      <td>{hm(d.loginSeconds)}</td>
                      <td>{d.sessions}</td>
                      <td>{d.calls}</td>
                      <td>{d.connected}</td>
                      <td>{hm(d.talkSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td>{hm(week.login)}</td>
                    <td>{u.days.reduce((t, d) => t + d.sessions, 0)}</td>
                    <td>{week.calls}</td>
                    <td>{week.connected}</td>
                    <td>{hm(week.talk)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div>
              <div className="ta-section-title">Assigned leads · {u.leads.total}</div>
              {stages.length ? (
                <div className="ta-chips" style={{ marginBottom: 16 }}>
                  {stages.map(([stage, n]) => (
                    <span key={stage} className="ta-chip">
                      <i style={{ background: stageConfig(stage)?.color || "#94a3b8" }} />
                      {stage} <b>{n}</b>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="ta-sub" style={{ marginBottom: 16 }}>No leads assigned.</div>
              )}

              <div className="ta-section-title">Recent logins</div>
              {u.login.recentSessions.length ? (
                <table className="ta-week">
                  <tbody>
                    {u.login.recentSessions.map((s) => (
                      <tr key={s.loginAt}>
                        <td>{fmtDateTime(s.loginAt)}</td>
                        <td>{s.logoutAt ? hm(s.seconds) : <span style={{ color: "#16a34a" }}>open</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="ta-sub">No logins in the last 7 days.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </HubModal>
  );
}
