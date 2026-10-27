import React, { useEffect, useMemo, useState } from "react";
import { Modal, Input, DatePicker, message, Tag, Empty } from "antd";
import dayjs from "dayjs";
import {
  TeamOutlined,
  CheckCircleOutlined,
  CoffeeOutlined,
  CalendarOutlined,
  ThunderboltOutlined,
  UserDeleteOutlined,
  LogoutOutlined,
  ClockCircleOutlined,
  PhoneOutlined,
  LeftOutlined,
  RightOutlined,
  ReloadOutlined,
  GiftOutlined,
  SearchOutlined,
  CloseOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import axios from "axios";
import { request } from "@/request";
import { API_BASE_URL } from "@/config/serverApiConfig";
import storePersist from "@/redux/storePersist";
// Shared modal look (lv-close, wm-modal, keyframes) + this page's timeline styles.
import "@/components/Workday/workday.css";
import "./worktracker.css";
import Sales360 from "./Sales360";

// HRMS → Work & Leave Tracker (backend /api/workday/admin/*). Who's working,
// on a break, on leave, auto-started or missing — for any day — with their
// login, breaks, dialer state and calls; every leave request with one-click
// Approve / Reject; and a per-user timeline of the day.

const STATUS = {
  working: { label: "Working", color: "#16a34a", icon: <CheckCircleOutlined /> },
  "on-break": { label: "On break", color: "#d97706", icon: <CoffeeOutlined /> },
  "auto-started": { label: "Auto-started (not logged in)", color: "#2563eb", icon: <ThunderboltOutlined /> },
  "on-leave": { label: "On leave", color: "#7c3aed", icon: <CalendarOutlined /> },
  "not-logged-in": { label: "Not logged in", color: "#dc2626", icon: <UserDeleteOutlined /> },
  "logged-out": { label: "Logged out", color: "#64748b", icon: <LogoutOutlined /> },
  "weekly-off": { label: "Weekly off", color: "#94a3b8", icon: <CalendarOutlined /> },
  holiday: { label: "Holiday", color: "#db2777", icon: <GiftOutlined /> },
};
const LEAVE_COLOR = { Approved: "green", Pending: "gold", Rejected: "red", Cancelled: "default", Withdrawn: "default" };
const EVENT = {
  shift_login: ["Logged in", "green"],
  shift_logout: ["Logged out", "gray"],
  auto_start: ["Dialer auto-started (11:00)", "blue"],
  pool_on: ["Dialer on", "green"],
  pool_off: ["Dialer off", "gray"],
  break_start: ["Break started", "orange"],
  break_end: ["Break ended", "orange"],
  leave_pause: ["Leave — dialer paused", "purple"],
  leave_applied: ["Leave applied", "purple"],
  leave_decided: ["Leave decided", "purple"],
};
// Timeline icon + colour per activity kind.
const EVENT_UI = {
  shift_login: { icon: "🟢", color: "#16a34a" },
  shift_logout: { icon: "🌙", color: "#64748b" },
  auto_start: { icon: "⚡", color: "#2563eb" },
  pool_on: { icon: "📡", color: "#16a34a" },
  pool_off: { icon: "⏹️", color: "#64748b" },
  break_start: { icon: "☕", color: "#d97706" },
  break_end: { icon: "▶️", color: "#d97706" },
  leave_pause: { icon: "🌴", color: "#7c3aed" },
  leave_applied: { icon: "📝", color: "#7c3aed" },
  leave_decided: { icon: "✅", color: "#7c3aed" },
};
const clock = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) : "—");
const hm = (min) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : "—");
const talk = (sec) => (sec ? `${Math.floor(sec / 60)}m` : "—");

function Badge({ status }) {
  const s = STATUS[status] || { label: status, color: "#64748b" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: s.color, background: `${s.color}14`, border: `1px solid ${s.color}33`, whiteSpace: "nowrap" }}>
      {s.icon} {s.label}
    </span>
  );
}

function Kpi({ label, value, color, icon, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: "1 1 140px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
        background: "var(--hub-surface)",
        border: `1px solid ${active ? color : "var(--hub-border)"}`,
        boxShadow: active ? `0 0 0 3px ${color}22` : "none",
        borderRadius: 14,
        padding: "12px 14px",
        color: "inherit",
      }}
    >
      <span style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: `${color}1a`, color, fontSize: 16, flexShrink: 0 }}>{icon}</span>
      <span>
        <span style={{ display: "block", fontSize: 20, fontWeight: 700, color: "var(--hub-text)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--hub-muted)" }}>{label}</span>
      </span>
    </button>
  );
}

// ── Day board ────────────────────────────────────────────────────────────
function Board({ onTimeline, on360 }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [date, setDate] = useState(dayjs());
  const [f, setF] = useState({ team: "", role: "", status: "", q: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const p = new URLSearchParams({ date: date.format("YYYY-MM-DD") });
    if (f.team) p.set("team", f.team);
    if (f.role) p.set("role", f.role);
    const r = await request.get({ entity: `workday/admin/board?${p}` });
    if (r?.success) setData(r.result);
    else message.error(r?.message || "Could not load the board.");
    setLoading(false);
  };
  useEffect(() => {
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, f.team, f.role]);

  // status + name search are client-side over the loaded day
  const rows = useMemo(() => {
    let r = data?.rows || [];
    if (f.status) r = r.filter((x) => x.status === f.status);
    if (f.q) r = r.filter((x) => x.name.toLowerCase().includes(f.q.toLowerCase()));
    return r;
  }, [data, f.status, f.q]);
  const k = data?.kpi || {};
  const toggle = (status) => setF((p) => ({ ...p, status: p.status === status ? "" : status }));

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 10 }}>
          <h3><TeamOutlined /> {data?.isToday ? "Today" : date.format("dddd, D MMM YYYY")}</h3>
          <div className="hub-row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="hub-btn" onClick={() => setDate(date.subtract(1, "day"))}><LeftOutlined /></button>
            <DatePicker value={date} onChange={(v) => v && setDate(v)} allowClear={false} format="ddd, D MMM YYYY" disabledDate={(d) => d.isAfter(dayjs(), "day")} />
            <button type="button" className="hub-btn" disabled={date.isSame(dayjs(), "day")} onClick={() => setDate(date.add(1, "day"))}><RightOutlined /></button>
            {!date.isSame(dayjs(), "day") && <button type="button" className="hub-btn" onClick={() => setDate(dayjs())}>Today</button>}
            <button type="button" className="hub-btn" onClick={load} title="Refresh"><ReloadOutlined /></button>
            <button type="button" className="hub-btn hub-btn-primary" onClick={() => setReportOpen(true)}><DownloadOutlined /> Download report</button>
          </div>
        </div>

        {data?.holiday && <div className="hub-empty" style={{ background: "#fdf2f8", color: "#9d174d", borderRadius: 10, padding: 10, marginBottom: 12 }}>🎉 Holiday — {data.holiday.name}. Nobody's dialer auto-starts today.</div>}
        {data?.weeklyOff && !data?.holiday && <div className="hub-empty" style={{ borderRadius: 10, padding: 10, marginBottom: 12 }}>Weekly off — no auto-start today.</div>}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Kpi label="Working" value={k.working ?? "—"} color="#16a34a" icon={<CheckCircleOutlined />} active={f.status === "working"} onClick={() => toggle("working")} />
          <Kpi label="On break" value={k.onBreak ?? "—"} color="#d97706" icon={<CoffeeOutlined />} active={f.status === "on-break"} onClick={() => toggle("on-break")} />
          <Kpi label="Auto-started" value={k.autoStarted ?? "—"} color="#2563eb" icon={<ThunderboltOutlined />} active={f.status === "auto-started"} onClick={() => toggle("auto-started")} />
          <Kpi label="On leave" value={k.onLeave ?? "—"} color="#7c3aed" icon={<CalendarOutlined />} active={f.status === "on-leave"} onClick={() => toggle("on-leave")} />
          <Kpi label="Not logged in" value={k.notLoggedIn ?? "—"} color="#dc2626" icon={<UserDeleteOutlined />} active={f.status === "not-logged-in"} onClick={() => toggle("not-logged-in")} />
          <Kpi label="Late (15m+)" value={k.late ?? "—"} color="#ea580c" icon={<ClockCircleOutlined />} />
          <Kpi label="Calls" value={k.calls ?? "—"} color="#0891b2" icon={<PhoneOutlined />} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginTop: 14 }}>
          <Input prefix={<SearchOutlined />} placeholder="Search a user" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} allowClear />
          <select className="hub-select" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })}>
            <option value="">All teams</option>
            {(data?.teams || []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="hub-select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="">All roles</option>
            {(data?.roles || []).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="hub-select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Any status</option>
            {Object.entries(STATUS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="hub-card">
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                <th>User</th><th>Status</th><th>Login</th><th>Logout</th><th>Worked</th><th>Breaks</th><th>Dialer</th><th>Leave</th><th>Calls</th><th />
              </tr>
            </thead>
            <tbody>
              {loading && !data && <tr><td colSpan={10}><div className="hub-empty">Loading…</div></td></tr>}
              {data && rows.length === 0 && <tr><td colSpan={10}><div className="hub-empty">Nobody matches these filters.</div></td></tr>}
              {rows.map((r) => (
                <tr key={r.adminId}>
                  <td>
                    <b>{r.name}</b>
                    <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>{r.role}{r.team ? ` · ${r.team}` : ""}</div>
                  </td>
                  <td><Badge status={r.status} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.loginAt ? clock(r.loginAt) : r.autoStartedAt ? <span style={{ color: "#2563eb" }}>auto {clock(r.autoStartedAt)}</span> : "—"}
                    {r.lateMin > 15 && <div style={{ fontSize: 11, color: "#ea580c", fontWeight: 700 }}>late {hm(r.lateMin)}</div>}
                  </td>
                  <td>{clock(r.logoutAt)}</td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{hm(r.workedMin)}</td>
                  <td>
                    {r.breaks.length === 0 ? "—" : (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {r.breaks.map((b, i) => (
                          <Tag key={i} color={b.open ? "orange" : "default"} title={`${clock(b.startAt)} – ${b.endAt ? clock(b.endAt) : "now"}`}>
                            {b.label} {b.minutes}m
                          </Tag>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    {r.dialer ? (
                      <span style={{ fontSize: 12, fontWeight: 600, color: r.dialer.on ? (r.dialer.status === "Paused" ? "#d97706" : "#16a34a") : "var(--hub-muted)" }}>
                        {r.dialer.on ? (r.dialer.status === "Paused" ? `Paused${r.dialer.breakKey === "leave" ? " (leave)" : ""}` : r.dialer.status) : "Off"}
                      </span>
                    ) : "—"}
                  </td>
                  <td>
                    {r.leaves.length === 0 ? "—" : r.leaves.map((l) => (
                      <div key={l._id} style={{ fontSize: 11.5 }}>
                        <Tag color={LEAVE_COLOR[l.status]} style={{ marginRight: 4 }}>{l.status}</Tag>{l.label}
                      </div>
                    ))}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <b>{r.calls}</b>
                    <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>{r.connected} connected · {talk(r.talkSec)}</div>
                  </td>
                  <td>
                    <div className="hub-row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <button type="button" className="hub-btn" style={{ padding: "4px 10px" }} onClick={() => onTimeline(r, date.format("YYYY-MM-DD"))}>Timeline</button>
                      <button type="button" className="hub-btn hub-btn-primary" style={{ padding: "4px 10px" }} onClick={() => on360(r)}>360°</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} users={data?.rows || []} />
    </div>
  );
}

// ── Monthly report download (backend /workday/admin/report → .xlsx) ──────
// Needs the auth header, so it's fetched as a blob, not a plain link.
async function downloadReport(month, adminId) {
  const token = storePersist.get("auth")?.current?.token;
  const p = new URLSearchParams({ month });
  if (adminId) p.set("adminId", adminId);
  const res = await axios.get(`${API_BASE_URL}workday/admin/report?${p}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    responseType: "blob",
  });
  const name = /filename="([^"]+)"/.exec(res.headers["content-disposition"] || "")?.[1] || `attendance-${month}.xlsx`;
  const url = URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// A blob error response carries the JSON message as text.
async function reportError(err) {
  try {
    const t = await err?.response?.data?.text?.();
    return JSON.parse(t).message;
  } catch (e) {
    return "Could not download the report.";
  }
}

function ReportModal({ open, onClose, users, fixedUser }) {
  const [month, setMonth] = useState(dayjs().startOf("month"));
  const [scope, setScope] = useState(fixedUser ? "one" : "all");
  const [userId, setUserId] = useState(fixedUser?.adminId || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && fixedUser) {
      setScope("one");
      setUserId(fixedUser.adminId);
    }
  }, [open, fixedUser]);

  const go = async () => {
    if (scope === "one" && !userId) return message.warning("Pick a user.");
    setBusy(true);
    try {
      await downloadReport(month.format("YYYY-MM"), scope === "one" ? userId : null);
      message.success("Report downloaded.");
      onClose();
    } catch (e) {
      message.error(await reportError(e));
    }
    setBusy(false);
  };

  const months = Array.from({ length: 6 }, (_, i) => dayjs().startOf("month").subtract(i, "month"));
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={520} closable={false} destroyOnClose className="wm-modal" styles={{ content: { padding: 0, overflow: "hidden", borderRadius: 20 } }}>
      <div className="rp-head">
        <span className="wm-head-ico">📊</span>
        <div className="wm-head-txt">
          <h2>Monthly attendance report</h2>
          <p>Excel · Summary, day-by-day and leaves</p>
        </div>
        <button type="button" className="lv-close" onClick={onClose} aria-label="Close"><CloseOutlined /></button>
      </div>
      <div className="wm-body">
        <div className="rp-label">Month</div>
        <div className="rp-months">
          {months.map((m) => (
            <button key={m.format("YYYY-MM")} type="button" className={m.isSame(month, "month") ? "on" : ""} onClick={() => setMonth(m)}>
              <b>{m.format("MMM")}</b>
              <span>{m.format("YYYY")}</span>
            </button>
          ))}
        </div>
        <DatePicker picker="month" value={month} onChange={(v) => v && setMonth(v)} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), "month")} style={{ width: "100%", marginTop: 8 }} format="MMMM YYYY" />

        <div className="rp-label">Who</div>
        <div className="rp-scope">
          <button type="button" className={scope === "all" ? "on" : ""} disabled={!!fixedUser} onClick={() => setScope("all")}>
            <span>👥</span>
            <b>All Sales users</b>
            <small>{users.length || ""} people · one file</small>
          </button>
          <button type="button" className={scope === "one" ? "on" : ""} onClick={() => setScope("one")}>
            <span>👤</span>
            <b>One user</b>
            <small>{fixedUser ? fixedUser.name : "pick below"}</small>
          </button>
        </div>
        {scope === "one" && !fixedUser && (
          <select className="hub-select lv-fade" style={{ width: "100%", marginTop: 10 }} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Select a user…</option>
            {users.map((u) => <option key={u.adminId} value={u.adminId}>{u.name} · {u.role}</option>)}
          </select>
        )}

        <div className="rp-incl">
          <span>📋 Summary — present / absent / leave days, attendance %, late days, avg login, hours, calls</span>
          <span>📅 Daily — login, logout, worked, breaks, leave and calls for every day</span>
          <span>🌴 Leaves — every request with status and who decided</span>
        </div>

        <button type="button" className="wm-btn rp-btn" disabled={busy} onClick={go}>
          {busy ? <span className="lv-spin" /> : <DownloadOutlined />} {busy ? "Preparing…" : `Download ${month.format("MMMM YYYY")}`}
        </button>
      </div>
    </Modal>
  );
}

// ── Leave requests ───────────────────────────────────────────────────────
function Leaves() {
  const [status, setStatus] = useState("Pending");
  const [q, setQ] = useState("");
  const [range, setRange] = useState(null);
  const [data, setData] = useState({ rows: [], counts: {}, count: 0 });
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState("");

  const load = async () => {
    setLoading(true);
    const p = new URLSearchParams({ status, items: "200" });
    if (q) p.set("q", q);
    if (range?.[0]) p.set("from", range[0].startOf("day").toISOString());
    if (range?.[1]) p.set("to", range[1].endOf("day").toISOString());
    const r = await request.get({ entity: `workday/admin/leaves?${p}` });
    if (r?.success) setData({ rows: r.result, counts: r.counts || {}, count: r.pagination?.count || 0 });
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, range]);

  const decide = async (id, action, n) => {
    const r = await request.post({ entity: `workday/admin/leave/${id}/decide`, jsonData: { action, note: n } });
    if (r?.success) {
      message.success(r.message);
      setRejecting(null);
      setNote("");
      load();
    } else message.error(r?.message || "Could not update.");
  };

  const total = Object.values(data.counts).reduce((t, n) => t + n, 0);
  return (
    <div className="hub-card">
      <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 10 }}>
        <h3><CalendarOutlined /> Leave requests</h3>
        <div className="hub-row" style={{ gap: 6, flexWrap: "wrap" }}>
          {["Pending", "Approved", "Rejected", "Cancelled", "All"].map((s) => (
            <button key={s} type="button" className={`hub-btn ${status === s ? "hub-btn-primary" : ""}`} onClick={() => setStatus(s)}>
              {s} {s === "All" ? total : data.counts[s] || 0}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 12 }}>
        <Input.Search placeholder="Search employee, press Enter" value={q} onChange={(e) => setQ(e.target.value)} onSearch={load} allowClear />
        <DatePicker.RangePicker value={range} onChange={setRange} format="D MMM YYYY" />
      </div>
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead>
            <tr><th>Employee</th><th>Type</th><th>When</th><th>Reason</th><th>Applied</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7}><div className="hub-empty">Loading…</div></td></tr>}
            {!loading && data.rows.length === 0 && <tr><td colSpan={7}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No ${status === "All" ? "" : status.toLowerCase()} leave requests`} /></td></tr>}
            {!loading && data.rows.map((l) => (
              <tr key={l._id}>
                <td><b>{l.employee}</b>{l.department && <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>{l.department}</div>}</td>
                <td>{l.leaveType}</td>
                <td style={{ minWidth: 200 }}>{l.label}</td>
                <td style={{ maxWidth: 260, fontSize: 12.5 }}>{l.reason || "—"}</td>
                <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{l.appliedOn ? dayjs(l.appliedOn).format("D MMM, h:mm A") : "—"}</td>
                <td>
                  <Tag color={LEAVE_COLOR[l.status]}>{l.status}</Tag>
                  {l.decisionBy && <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>by {l.decisionBy}</div>}
                  {l.decisionNote && <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>“{l.decisionNote}”</div>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {l.status === "Pending" && (
                    <div className="hub-row" style={{ gap: 6 }}>
                      <button type="button" className="hub-btn" style={{ background: "#16a34a", color: "#fff", borderColor: "#16a34a" }} onClick={() => decide(l._id, "approve")}>Approve</button>
                      <button type="button" className="hub-btn" style={{ color: "#dc2626", borderColor: "#fecaca" }} onClick={() => setRejecting(l)}>Reject</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!rejecting}
        onCancel={() => setRejecting(null)}
        title={rejecting ? `Reject ${rejecting.employee}'s leave?` : ""}
        okText="Reject"
        okButtonProps={{ danger: true }}
        onOk={() => decide(rejecting._id, "reject", note)}
      >
        <p style={{ color: "#64748b" }}>{rejecting?.label}</p>
        <Input.TextArea rows={3} placeholder="Reason (shown to the employee)" value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </div>
  );
}

// ── Timeline modal ───────────────────────────────────────────────────────
function TimelineModal({ target, onClose }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("all"); // all | activity | call
  const [report, setReport] = useState(false);
  useEffect(() => {
    if (!target) return;
    setData(null);
    setFilter("all");
    request.get({ entity: `workday/admin/timeline?adminId=${target.row.adminId}&date=${target.date}` }).then((r) => r?.success && setData(r.result));
  }, [target]);
  if (!target) return null;

  const items = data
    ? [
        ...data.events.map((e) => {
          const meta = EVENT_UI[e.kind] || { icon: "•", color: "#64748b" };
          return {
            at: e.at,
            kind: "activity",
            icon: meta.icon,
            color: meta.color,
            text: (EVENT[e.kind] || [e.kind])[0],
            sub: [e.detail, e.byName && e.byName !== target.row.name ? `by ${e.byName}` : null].filter(Boolean).join(" · "),
          };
        }),
        ...data.calls.map((c) => {
          const conn = c.answeredAt && c.duration > 0;
          return {
            at: c.created,
            kind: "call",
            icon: c.direction === "Inbound" ? "📲" : conn ? "📞" : "📵",
            color: conn ? "#16a34a" : "#94a3b8",
            text: `${c.direction === "Inbound" ? "Incoming call" : "Call"} · ${c.contactName || c.phone}`,
            sub: `${conn ? `${Math.floor(c.duration / 60)}m ${c.duration % 60}s talk` : "not connected"}${c.disposition ? ` · ${c.disposition}` : ""}`,
          };
        }),
      ].sort((a, b) => new Date(a.at) - new Date(b.at))
    : [];
  const shown = items.filter((it) => filter === "all" || it.kind === filter);
  const r = target.row;
  const st = STATUS[r.status] || { label: r.status, color: "#64748b" };
  const initials = r.name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase();
  const stats = [
    ["🕙", r.loginAt ? clock(r.loginAt) : r.autoStartedAt ? `auto ${clock(r.autoStartedAt)}` : "—", r.lateMin > 15 ? `late ${hm(r.lateMin)}` : "Login", "#2563eb"],
    ["⏱️", hm(r.workedMin), "Worked", "#16a34a"],
    ["☕", `${r.breakMin}m`, `${r.breaks.length} break${r.breaks.length === 1 ? "" : "s"}`, "#d97706"],
    ["📞", r.calls, `${r.connected} connected · ${talk(r.talkSec)}`, "#0891b2"],
  ];

  return (
    <Modal open onCancel={onClose} footer={null} width={680} closable={false} destroyOnClose className="wm-modal tl-modal" styles={{ content: { padding: 0, overflow: "hidden", borderRadius: 20 } }}>
      <div className="tl-head">
        <span className="tl-avatar">{initials}</span>
        <div className="tl-head-txt">
          <h2>{r.name}</h2>
          <p>{r.role}{r.team ? ` · ${r.team}` : ""} · {dayjs(target.date).format("dddd, D MMM YYYY")}</p>
        </div>
        <span className="tl-status" style={{ "--c": st.color }}>{st.icon} {st.label}</span>
        <button type="button" className="tl-dl" onClick={() => setReport(true)} title={`Download ${r.name}'s monthly report`}><DownloadOutlined /> Month report</button>
        <button type="button" className="lv-close" onClick={onClose} aria-label="Close"><CloseOutlined /></button>
      </div>

      <div className="tl-body">
        <div className="tl-stats">
          {stats.map(([ico, v, k, c], i) => (
            <div key={k} className="tl-stat" style={{ "--c": c, animationDelay: `${i * 50}ms` }}>
              <span className="tl-stat-ico">{ico}</span>
              <b>{v}</b>
              <span>{k}</span>
            </div>
          ))}
        </div>

        {r.breaks.length > 0 && (
          <div className="tl-breaks">
            {r.breaks.map((b, i) => (
              <span key={i} className={b.open ? "open" : ""}>☕ {b.label} · {clock(b.startAt)}–{b.endAt ? clock(b.endAt) : "now"} · {b.minutes}m</span>
            ))}
          </div>
        )}

        <div className="tl-filter">
          {[
            ["all", "Everything", items.length],
            ["activity", "Activity", items.filter((x) => x.kind === "activity").length],
            ["call", "Calls", items.filter((x) => x.kind === "call").length],
          ].map(([k, l, n]) => (
            <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
              {l} <em>{n}</em>
            </button>
          ))}
        </div>

        <div className="tl-scroll">
          {!data && (
            <div className="tl-skel">
              {[0, 1, 2].map((i) => <div key={i} />)}
            </div>
          )}
          {data && shown.length === 0 && (
            <div className="tl-empty">
              <span>{filter === "call" ? "📵" : "🗓️"}</span>
              <b>{filter === "call" ? "No calls this day" : "No activity recorded"}</b>
              <p>
                {r.status === "not-logged-in"
                  ? `${r.name.split(" ")[0]} hasn't logged in${target.date === dayjs().format("YYYY-MM-DD") ? " yet today" : " this day"}.`
                  : r.status === "on-leave"
                  ? "On leave this day."
                  : r.status === "holiday" || r.status === "weekly-off"
                  ? "It was a day off."
                  : "Nothing was logged for this filter."}
              </p>
            </div>
          )}
          {data && shown.length > 0 && (
            <ol className="tl-list">
              {shown.map((it, i) => (
                <li key={i} style={{ "--c": it.color, animationDelay: `${Math.min(i, 20) * 35}ms` }} className={it.kind}>
                  <time>{clock(it.at)}</time>
                  <span className="tl-dot">{it.icon}</span>
                  <div className="tl-card">
                    <b>{it.text}</b>
                    {it.sub && <span>{it.sub}</span>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <ReportModal open={report} onClose={() => setReport(false)} users={[r]} fixedUser={r} />
    </Modal>
  );
}

export default function WorkTracker() {
  const [tab, setTab] = useState("board");
  const [timeline, setTimeline] = useState(null);
  const [focusUser, setFocusUser] = useState("");
  return (
    <div className="hub-stack">
      <div className="hub-row" style={{ gap: 6 }}>
        {[
          ["board", "Day board"],
          ["360", "360° Performance"],
          ["leaves", "Leave requests"],
        ].map(([k, l]) => (
          <button key={k} type="button" className={`hub-btn ${tab === k ? "hub-btn-primary" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "board" && (
        <Board
          onTimeline={(row, date) => setTimeline({ row, date })}
          on360={(row) => {
            setFocusUser(row.adminId);
            setTab("360");
          }}
        />
      )}
      {tab === "360" && <Sales360 initialUser={focusUser} />}
      {tab === "leaves" && <Leaves />}
      <TimelineModal target={timeline} onClose={() => setTimeline(null)} />
    </div>
  );
}
