import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import dayjs from "dayjs";
import { request } from "@/request";
import { API_BASE_URL } from "@/config/serverApiConfig";
import storePersist from "@/redux/storePersist";
import ChartCanvas, { PALETTE, fillRgba } from "@/components/dashboard/ChartCanvas";
import {
  DownloadOutlined,
  PhoneOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  LoginOutlined,
  LogoutOutlined,
  CoffeeOutlined,
  SwapOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";

// Advanced Reporting → User Activity. Everything a user did in a date range
// (or every user at once), on screen and as a PDF.
// Backend: GET /api/reports/user-activity[/users|/pdf] — controllers/
// appControllers/core/userActivityReport.js + services/reports/userActivity.js.

const today = () => dayjs().format("YYYY-MM-DD");
const PRESETS = [
  { key: "today", label: "Today", range: () => [today(), today()] },
  { key: "yesterday", label: "Yesterday", range: () => { const d = dayjs().subtract(1, "day").format("YYYY-MM-DD"); return [d, d]; } },
  { key: "7d", label: "7 days", range: () => [dayjs().subtract(6, "day").format("YYYY-MM-DD"), today()] },
  { key: "30d", label: "30 days", range: () => [dayjs().subtract(29, "day").format("YYYY-MM-DD"), today()] },
  { key: "month", label: "This month", range: () => [dayjs().startOf("month").format("YYYY-MM-DD"), today()] },
  { key: "lastmonth", label: "Last month", range: () => [dayjs().subtract(1, "month").startOf("month").format("YYYY-MM-DD"), dayjs().subtract(1, "month").endOf("month").format("YYYY-MM-DD")] },
  { key: "custom", label: "Custom" },
];

const fmtDur = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
};
const fmtMin = (m) => fmtDur((m || 0) * 60);
const fmtDT = (d) => (d ? dayjs(d).format("DD MMM, hh:mm A") : "—");
const fmtTime = (d) => (d ? dayjs(d).format("hh:mm A") : "—");
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
const OUTCOME_BADGE = { Connected: "hub-badge-green", "Not picked up": "hub-badge-yellow", "Missed by agent": "hub-badge-red" };
const EVENT_META = {
  login: { icon: <LoginOutlined />, color: "#2563eb", label: "Login" },
  logout: { icon: <LogoutOutlined />, color: "#64748b", label: "Logout" },
  pool_on: { icon: <ThunderboltOutlined />, color: "#16a34a", label: "Pool ON" },
  pool_off: { icon: <ThunderboltOutlined />, color: "#dc2626", label: "Pool OFF" },
  break_start: { icon: <CoffeeOutlined />, color: "#d97706", label: "Break" },
  break_end: { icon: <CoffeeOutlined />, color: "#d97706", label: "Break end" },
  call: { icon: <PhoneOutlined />, color: "#7c3aed", label: "Call" },
  stage: { icon: <SwapOutlined />, color: "#0891b2", label: "Stage" },
};

function Kpi({ label, value, hint, tone }) {
  return (
    <div className="hub-kpi" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--hub-muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: tone || "var(--hub-text)" }}>{value}</div>
      {hint && <div style={{ fontSize: 11.5, color: "var(--hub-muted)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}
const KpiGrid = ({ children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>{children}</div>
);
const Card = ({ title, sub, right, children }) => (
  <div className="hub-card">
    {(title || right) && (
      <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          {sub && <div style={{ fontSize: 12, color: "var(--hub-muted)", marginTop: 2 }}>{sub}</div>}
        </div>
        {right}
      </div>
    )}
    {children}
  </div>
);

const barData = (labels, sets) => ({
  labels,
  datasets: sets.map(([label, data, color]) => ({ label, data, backgroundColor: fillRgba(color, 0.85), borderRadius: 4, maxBarThickness: 28 })),
});
const barOpts = { plugins: { legend: { display: true, position: "bottom" } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } };

export default function UserActivity() {
  const [users, setUsers] = useState([]);
  const [user, setUser] = useState("all");
  const [preset, setPreset] = useState("7d");
  const [range, setRange] = useState(PRESETS[2].range());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    request.get({ entity: "reports/user-activity/users" }).then((r) => r?.success && setUsers(r.result));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");
    const qs = new URLSearchParams({ user, from: range[0], to: range[1] });
    request.get({ entity: `reports/user-activity?${qs}` }).then((r) => {
      if (!alive) return;
      setLoading(false);
      if (r?.success) setData(r.result);
      else setErr(r?.message || "Could not load the report.");
    });
    return () => {
      alive = false;
    };
  }, [user, range]);

  const pickPreset = (p) => {
    setPreset(p.key);
    if (p.range) setRange(p.range());
  };

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const auth = storePersist.get("auth");
      const qs = new URLSearchParams({ user, from: range[0], to: range[1] });
      const res = await axios.get(`${API_BASE_URL}reports/user-activity/pdf?${qs}`, {
        responseType: "blob",
        withCredentials: true,
        headers: auth ? { Authorization: `Bearer ${auth.current.token}` } : {},
      });
      const cd = res.headers["content-disposition"] || "";
      const name = (/filename="([^"]+)"/.exec(cd) || [])[1] || "Activity-Report.pdf";
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      window.alert("Could not create the PDF — please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const active = users.filter((u) => !u.deleted);
  const deleted = users.filter((u) => u.deleted);

  return (
    <div className="hub-stack">
      <Card
        title="User Activity — everything a user did"
        sub="Online time, lead-pool ON/OFF, every call and response, pipeline moves, demos, payments and access — for one user or everyone."
        right={
          <button type="button" className="hub-btn hub-btn-primary" onClick={downloadPdf} disabled={downloading || loading}>
            <DownloadOutlined /> {downloading ? "Creating PDF…" : "Download PDF"}
          </button>
        }
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <select className="hub-select" style={{ minWidth: 230 }} value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="all">👥 All users</option>
            <optgroup label="Users">
              {active.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}{u.enabled ? "" : " (deactivated)"}
                </option>
              ))}
            </optgroup>
            {deleted.length > 0 && (
              <optgroup label="Deleted users">
                {deleted.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
              </optgroup>
            )}
          </select>
          <div className="hub-pill-filter">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`hub-btn ${preset === p.key ? "hub-btn-primary" : ""}`}
                style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12.5, border: "none" }}
                onClick={() => pickPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <>
              <input type="date" className="hub-input" style={{ width: 150 }} value={range[0]} max={range[1]} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} />
              <span style={{ color: "var(--hub-muted)" }}>to</span>
              <input type="date" className="hub-input" style={{ width: 150 }} value={range[1]} min={range[0]} max={today()} onChange={(e) => e.target.value && setRange([range[0], e.target.value])} />
            </>
          )}
        </div>
      </Card>

      {err && <div className="hub-card hub-empty">{err}</div>}
      {loading && !data && <div className="hub-card hub-empty">Building the report…</div>}
      {data && data.kind === "all" && <AllView data={data} loading={loading} onOpen={setUser} />}
      {data && data.kind === "one" && <OneView data={data} loading={loading} onBack={() => setUser("all")} />}
    </div>
  );
}

// ── everyone ───────────────────────────────────────────────────────────
const COLS = [
  ["name", "User"],
  ["onlineSeconds", "CRM open"],
  ["poolMinutes", "Pool"],
  ["poolOns", "Pool ON"],
  ["calls", "Calls"],
  ["connected", "Connected"],
  ["connectRate", "Rate"],
  ["talkSeconds", "Talk"],
  ["missed", "Missed"],
  ["stageMoves", "Moves"],
  ["demosBooked", "Demos"],
  ["paidAmount", "Paid"],
];
function AllView({ data, loading, onOpen }) {
  const t = data.totals;
  const [sort, setSort] = useState(["calls", -1]);
  const rows = useMemo(() => {
    const [k, dir] = sort;
    return [...data.rows].sort((a, b) => (typeof a[k] === "string" ? a[k].localeCompare(b[k]) : (a[k] || 0) - (b[k] || 0)) * dir);
  }, [data.rows, sort]);
  const cell = (r, k) => {
    const v = r[k];
    if (k === "name")
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="hub-avatar" style={{ width: 30, height: 30, fontSize: 12 }}>{initials(v)}</span>
          <div>
            <div style={{ fontWeight: 700 }}>{v}</div>
            <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>
              {r.role}
              {r.deleted ? " · deleted" : !r.enabled ? " · deactivated" : ""}
            </div>
          </div>
        </div>
      );
    if (!v) return <span style={{ color: "var(--hub-muted)" }}>—</span>;
    if (k === "onlineSeconds" || k === "talkSeconds") return fmtDur(v);
    if (k === "poolMinutes") return fmtMin(v);
    if (k === "connectRate") return `${v}%`;
    if (k === "paidAmount") return inr(v);
    return v;
  };
  return (
    <div className="hub-stack" style={{ opacity: loading ? 0.6 : 1 }}>
      <KpiGrid>
        <Kpi label="Active users" value={`${t.activeUsers}/${t.users}`} hint="did something in this range" />
        <Kpi label="CRM open time" value={fmtDur(t.onlineSeconds)} hint={`${t.sessions} sittings`} />
        <Kpi label="Lead pool time" value={fmtMin(t.poolMinutes)} hint={`${t.poolOns} times ON`} />
        <Kpi label="Calls" value={t.calls} hint={`${t.connectRate}% connected`} />
        <Kpi label="Connected" value={t.connected} tone="#16a34a" hint={`${t.missed} missed by agents`} />
        <Kpi label="Talk time" value={fmtDur(t.talkSeconds)} />
        <Kpi label="Stage moves" value={t.stageMoves} />
        <Kpi label="Payments paid" value={t.paidCount} hint={inr(t.paidAmount)} />
      </KpiGrid>
      {t.calls > 0 && (
        <Card title="Team calls per day" sub="All calls vs connected">
          <ChartCanvas
            type="bar"
            height={260}
            data={barData(data.daily.map((d) => dayjs(d.day).format("DD MMM")), [["Calls", data.daily.map((d) => d.calls), PALETTE.blue], ["Connected", data.daily.map((d) => d.connected), PALETTE.green]])}
            options={barOpts}
          />
        </Card>
      )}
      <Card title={`Every user (${rows.length})`} sub="Click a column to sort · click a user for their full report">
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr>
                {COLS.map(([k, label]) => (
                  <th key={k} style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => setSort(([sk, d]) => [k, sk === k ? -d : k === "name" ? 1 : -1])}>
                    {label}
                    {sort[0] === k ? (sort[1] > 0 ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onOpen(r.id)} title="Open full report">
                  {COLS.map(([k]) => <td key={k} style={{ whiteSpace: k === "name" ? "normal" : "nowrap" }}>{cell(r, k)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── one user ───────────────────────────────────────────────────────────
function OneView({ data, loading, onBack }) {
  const p = data.profile;
  const s = data.summary;
  const [tab, setTab] = useState("calls");
  const [callQ, setCallQ] = useState("");
  const [callOutcome, setCallOutcome] = useState("");
  const [evKind, setEvKind] = useState("");
  const days = data.timeline.map((t) => dayjs(t.day).format("DD MMM"));

  const calls = data.calls.list.filter(
    (c) =>
      (!callOutcome || c.outcome === callOutcome) &&
      (!callQ || `${c.name} ${c.phone} ${c.disposition || ""} ${c.notes || ""}`.toLowerCase().includes(callQ.toLowerCase()))
  );
  const events = data.events.filter((e) => !evKind || e.kind === evKind || (evKind === "pool" && e.kind.startsWith("pool")) || (evKind === "session" && (e.kind === "login" || e.kind === "logout")));
  const eventsByDay = useMemo(() => {
    const m = new Map();
    for (const e of [...events].reverse()) {
      const k = dayjs(e.at).format("dddd, DD MMM YYYY");
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return [...m.entries()];
  }, [events]);

  const status = p.deleted ? ["Deleted", "hub-badge-red"] : p.enabled ? ["Active", "hub-badge-green"] : ["Deactivated", "hub-badge-gray"];
  const tracked = new Date(data.activityTrackedFrom) > new Date(`${data.range.from}T00:00:00+05:30`);

  return (
    <div className="hub-stack" style={{ opacity: loading ? 0.6 : 1 }}>
      <div className="hub-card" style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
        <button type="button" className="hub-btn" onClick={onBack} title="Back to all users"><ArrowLeftOutlined /></button>
        <span className="hub-avatar" style={{ width: 56, height: 56, fontSize: 20 }}>{initials(p.name)}</span>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 22 }}>{p.name}</h2>
            <span className="hub-badge hub-badge-blue">{p.subRole ? `${p.role} · ${p.subRole}` : p.role}</span>
            <span className={`hub-badge ${status[1]}`}>{status[0]}</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--hub-muted)", marginTop: 4, wordBreak: "break-word" }}>
            {p.email}
            {p.phone ? ` · ${p.phone}` : ""}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "6px 22px", flex: "2 1 420px", fontSize: 12.5 }}>
          {[
            ["Team", p.team ? `${p.team}${p.teamLead ? ` (${p.teamLead})` : ""}` : "—"],
            ["Reports to", p.manager || "—"],
            ["Business", p.business || "—"],
            ["Joined", dayjs(p.joined).format("DD MMM YYYY")],
            ["Last seen", fmtDT(p.lastSeenAt)],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ color: "var(--hub-muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{k}</div>
              <div style={{ fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <KpiGrid>
        <Kpi label="CRM open time" value={fmtDur(s.onlineSeconds)} hint={`${s.sessions} sittings`} />
        <Kpi label="Lead pool time" value={fmtMin(s.poolMinutes)} hint={`${s.poolOns} ON · ${s.poolOffs} OFF · ${s.breaks} breaks`} />
        <Kpi label="Calls" value={s.calls} hint={`${s.connectRate}% connected`} />
        <Kpi label="Connected" value={s.connected} tone="#16a34a" hint={`${s.notPicked} not picked`} />
        <Kpi label="Missed by agent" value={s.missed} tone={s.missed ? "#dc2626" : undefined} hint="routed to them, not picked up" />
        <Kpi label="Talk time" value={fmtDur(s.talkSeconds)} hint={`avg ${fmtDur(s.avgTalk)} · longest ${fmtDur(s.longestCall)}`} />
        <Kpi label="Stage moves" value={s.stageMoves} hint="leads moved in the pipeline" />
        <Kpi label="Demos" value={s.demosBooked} hint={`${s.demosAttended} attended`} />
        <Kpi label="Callbacks" value={data.callbacks.total} hint={Object.entries(data.callbacks.byStatus).map(([k, v]) => `${v} ${k}`).join(" · ") || "—"} />
        <Kpi label="Payments paid" value={data.payments.paid} hint={`${inr(data.payments.paidAmount)} · ${data.payments.created} links`} />
        <Kpi label="Finance KYC" value={data.finance.created} hint={`${data.finance.submitted} submitted`} />
        <Kpi label="Tickets raised" value={data.tickets.raised} hint={`${data.tickets.open} open`} />
      </KpiGrid>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
        <Card title="Calls per day" sub="All calls vs connected">
          <ChartCanvas type="bar" height={240} data={barData(days, [["Calls", data.timeline.map((t) => t.calls), PALETTE.blue], ["Connected", data.timeline.map((t) => t.connected), PALETTE.green]])} options={barOpts} />
        </Card>
        <Card title="Time per day" sub="CRM open vs lead pool (hours)">
          <ChartCanvas
            type="bar"
            height={240}
            data={barData(days, [["CRM open", data.timeline.map((t) => +(t.onlineSeconds / 3600).toFixed(1)), PALETTE.blue], ["Lead pool", data.timeline.map((t) => +(t.poolMinutes / 60).toFixed(1)), PALETTE.green]])}
            options={barOpts}
          />
        </Card>
        <Card title="Calls by hour (IST)" sub="When this user works the phone">
          <ChartCanvas type="bar" height={240} data={barData(data.calls.byHour.map((_, h) => `${h}:00`), [["Calls", data.calls.byHour, PALETTE.purple]])} options={{ ...barOpts, plugins: { legend: { display: false } } }} />
        </Card>
        <Card title="Responses saved" sub="Disposition picked after the call">
          {data.calls.byDisposition.length ? (
            <ChartCanvas
              type="bar"
              height={240}
              data={barData(data.calls.byDisposition.slice(0, 12).map((x) => x.disposition), [["Calls", data.calls.byDisposition.slice(0, 12).map((x) => x.count), PALETTE.amber]])}
              options={{ indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }}
            />
          ) : (
            <div className="hub-empty">No calls in this range.</div>
          )}
        </Card>
      </div>

      <Card title="Day by day">
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr><th>Date</th><th>First in</th><th>Last out</th><th>CRM open</th><th>Lead pool</th><th>Calls</th><th>Connected</th><th>Talk</th><th>Stage moves</th></tr>
            </thead>
            <tbody>
              {[...data.timeline].reverse().map((t) => (
                <tr key={t.day}>
                  <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{dayjs(t.day).format("ddd, DD MMM")}</td>
                  <td>{fmtTime(t.firstLogin)}</td>
                  <td>{fmtTime(t.lastLogout)}</td>
                  <td>{t.onlineSeconds ? fmtDur(t.onlineSeconds) : "—"}</td>
                  <td>{t.poolMinutes ? fmtMin(t.poolMinutes) : "—"}</td>
                  <td>{t.calls || "—"}</td>
                  <td>{t.connected || "—"}</td>
                  <td>{t.talkSeconds ? fmtDur(t.talkSeconds) : "—"}</td>
                  <td>{t.stageMoves || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tracked && (
          <div style={{ fontSize: 12, color: "var(--hub-muted)", marginTop: 8 }}>
            Lead-pool ON/OFF and breaks are recorded from {dayjs(data.activityTrackedFrom).format("DD MMM YYYY")} — earlier days show no pool time.
          </div>
        )}
      </Card>

      <Card
        title="Details"
        right={
          <div className="hub-pill-filter">
            {[
              ["calls", `Calls (${data.calls.list.length})`],
              ["moves", `Pipeline moves (${data.stageMoves.length})`],
              ["payments", `Payments (${data.payments.list.length})`],
              ["timeline", "Timeline"],
              ["access", "Access"],
            ].map(([k, label]) => (
              <button key={k} type="button" className={`hub-btn ${tab === k ? "hub-btn-primary" : ""}`} style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12.5, border: "none" }} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        {tab === "calls" && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <input className="hub-input" style={{ width: 240 }} placeholder="Search name, phone, response, notes" value={callQ} onChange={(e) => setCallQ(e.target.value)} />
              <select className="hub-select" style={{ width: 170 }} value={callOutcome} onChange={(e) => setCallOutcome(e.target.value)}>
                <option value="">All outcomes</option>
                <option>Connected</option>
                <option>Not picked up</option>
                <option>Missed by agent</option>
              </select>
            </div>
            <div className="hub-table-wrapper">
              <table className="hub-table">
                <thead>
                  <tr><th>When</th><th>Contact</th><th>Type</th><th>Outcome</th><th>Talk</th><th>Response</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {calls.length === 0 && <tr><td colSpan={7}><div className="hub-empty">No calls.</div></td></tr>}
                  {calls.slice(0, 300).map((c, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDT(c.at)}</td>
                      <td>{c.name || "—"}<div style={{ fontSize: 11, color: "#94a3b8" }}>{c.phone}</div></td>
                      <td style={{ fontSize: 12 }}>{c.type}</td>
                      <td><span className={`hub-badge ${OUTCOME_BADGE[c.outcome] || "hub-badge-gray"}`}>{c.outcome}</span></td>
                      <td>{c.durationSec ? fmtDur(c.durationSec) : "—"}</td>
                      <td style={{ fontWeight: 700, fontSize: 12 }}>{c.disposition || "—"}</td>
                      <td style={{ fontSize: 12, color: "#475569", maxWidth: 320, whiteSpace: "pre-wrap" }}>{c.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {calls.length > 300 && <div style={{ fontSize: 12, color: "var(--hub-muted)", marginTop: 8 }}>Showing the latest 300 here — the PDF has all of them.</div>}
          </>
        )}
        {tab === "moves" && (
          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead><tr><th>When</th><th>Lead</th><th>From</th><th>To</th><th>Remarks</th></tr></thead>
              <tbody>
                {data.stageMoves.length === 0 && <tr><td colSpan={5}><div className="hub-empty">No pipeline moves.</div></td></tr>}
                {data.stageMoves.map((m, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDT(m.at)}</td>
                    <td>{m.name || "—"}<div style={{ fontSize: 11, color: "#94a3b8" }}>{m.phone}</div></td>
                    <td style={{ fontSize: 12 }}>{m.from || "—"}</td>
                    <td style={{ fontSize: 12, fontWeight: 700 }}>{m.to}{m.sub ? <div style={{ fontWeight: 500, color: "#94a3b8" }}>{m.sub}</div> : null}</td>
                    <td style={{ fontSize: 12, color: "#475569" }}>{m.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "payments" && (
          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead><tr><th>When</th><th>Candidate</th><th>Internship</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {data.payments.list.length === 0 && <tr><td colSpan={5}><div className="hub-empty">No payment links raised.</div></td></tr>}
                {data.payments.list.map((x, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDT(x.at)}</td>
                    <td>{x.name}</td>
                    <td style={{ fontSize: 12 }}>{x.course || "—"}</td>
                    <td>{inr(x.amount)}</td>
                    <td><span className={`hub-badge ${x.status === "paid" ? "hub-badge-green" : "hub-badge-gray"}`}>{x.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "timeline" && (
          <>
            <div className="hub-pill-filter" style={{ marginBottom: 12 }}>
              {[["", "Everything"], ["session", "Login / logout"], ["pool", "Lead pool"], ["call", "Calls"], ["stage", "Stage moves"]].map(([k, label]) => (
                <button key={k || "all"} type="button" className={`hub-btn ${evKind === k ? "hub-btn-primary" : ""}`} style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12.5, border: "none" }} onClick={() => setEvKind(k)}>
                  {label}
                </button>
              ))}
            </div>
            {eventsByDay.length === 0 && <div className="hub-empty">Nothing recorded.</div>}
            <div style={{ display: "grid", gap: 16, maxHeight: 640, overflowY: "auto" }}>
              {eventsByDay.map(([day, evs]) => (
                <div key={day}>
                  <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>{day}</div>
                  <div style={{ borderLeft: "2px solid var(--hub-border)", marginLeft: 8, paddingLeft: 14, display: "grid", gap: 8 }}>
                    {evs.map((e, i) => {
                      const meta = EVENT_META[e.kind] || { icon: <ClockCircleOutlined />, color: "#64748b", label: e.kind };
                      return (
                        <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5 }}>
                          <span style={{ color: meta.color, marginLeft: -24, background: "var(--hub-surface)", padding: 1 }}>{meta.icon}</span>
                          <span style={{ color: "var(--hub-muted)", width: 64, flexShrink: 0 }}>{fmtTime(e.at)}</span>
                          <span style={{ fontWeight: 700, color: meta.color, width: 70, flexShrink: 0 }}>{meta.label}</span>
                          <span style={{ minWidth: 0, wordBreak: "break-word" }}>{e.text}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {tab === "access" &&
          (data.access ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {data.access.map((a) => (
                <span key={a.module} className="hub-badge hub-badge-blue" style={{ padding: "6px 10px" }}>
                  {a.module}: {[a.view && "view", a.edit && "edit", a.delete && "delete"].filter(Boolean).join(" · ")}
                </span>
              ))}
            </div>
          ) : (
            <div className="hub-empty">No custom permissions — the {p.role} role defaults apply.</div>
          ))}
      </Card>
    </div>
  );
}

