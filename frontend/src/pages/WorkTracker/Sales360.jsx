import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { DatePicker, Input, Modal, message } from "antd";
import dayjs from "dayjs";
import axios from "axios";
import {
  PhoneOutlined,
  CheckCircleOutlined,
  FieldTimeOutlined,
  AudioOutlined,
  PieChartOutlined,
  ClockCircleOutlined,
  CoffeeOutlined,
  ThunderboltOutlined,
  FormOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  CloseOutlined,
  PlayCircleFilled,
  PauseCircleFilled,
  DownloadOutlined,
  LeftOutlined,
  RightOutlined,
  ArrowLeftOutlined,
  CalendarOutlined,
  TeamOutlined,
  DashboardOutlined,
  FileExcelOutlined,
  ScheduleOutlined,
  StarOutlined,
  TrophyOutlined,
  WalletOutlined,
  HourglassOutlined,
  DislikeOutlined,
  FunnelPlotOutlined,
  AimOutlined,
  BellOutlined,
} from "@ant-design/icons";
import { request } from "@/request";
import { getSocket } from "@/socket";
import { API_BASE_URL } from "@/config/serverApiConfig";
import storePersist from "@/redux/storePersist";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import ChartCanvas, { PALETTE, fillRgba } from "@/components/dashboard/ChartCanvas";
import { rowsToCsv, downloadCsv } from "@/components/dashboard/csvExport";
import "./sales360.css";

// Sales 360° Performance (backend /api/workday/admin/360*). Everything a Sales
// user did over any range — one minute of a day up to a year: attendance,
// calls, talk time, outcomes, lead responses, a minute-by-minute day strip and
// every call with its recording. Management sees the whole team (leaderboard
// → click a person to drill in); everyone else sees only their own 360°.
// Shown on Sales › Dashboard and HR › Work & Leave Tracker.

// Mirrors backend services/access/salesScope.js FULL_ACCESS_ROLES.
const FULL_ACCESS = ["owner", "Super Admin", "Admin", "Sales Manager", "Team Manager"];

const PRESETS = [
  { key: "today", label: "Today", range: () => [dayjs().startOf("day"), dayjs()] },
  { key: "yesterday", label: "Yesterday", range: () => [dayjs().subtract(1, "day").startOf("day"), dayjs().subtract(1, "day").endOf("day")] },
  { key: "7d", label: "7 days", range: () => [dayjs().subtract(6, "day").startOf("day"), dayjs()] },
  { key: "30d", label: "30 days", range: () => [dayjs().subtract(29, "day").startOf("day"), dayjs()] },
  { key: "month", label: "This month", range: () => [dayjs().startOf("month"), dayjs()] },
  { key: "lastmonth", label: "Last month", range: () => [dayjs().subtract(1, "month").startOf("month"), dayjs().subtract(1, "month").endOf("month")] },
  { key: "90d", label: "3 months", range: () => [dayjs().subtract(89, "day").startOf("day"), dayjs()] },
  { key: "year", label: "1 year", range: () => [dayjs().subtract(1, "year").add(1, "day").startOf("day"), dayjs()] },
];
const OUTCOME = {
  connected: ["Connected", "#15803D"],
  missed: ["Missed by user", "#B91C1C"],
  "no-answer": ["No answer", "#B45309"],
  busy: ["Busy", "#7C3AED"],
  failed: ["Failed", "#64748B"],
  cancelled: ["Cancelled", "#94A3B8"],
  completed: ["Ended, no talk", "#0E7490"],
  voicemail: ["Voicemail", "#BE185D"],
};
const DAY_STATUS = {
  present: ["Present", "#15803D"],
  auto: ["Auto-started", "#2563EB"],
  absent: ["Absent", "#B91C1C"],
  leave: ["Leave", "#7C3AED"],
  holiday: ["Holiday", "#BE185D"],
  "weekly-off": ["Weekly off", "#64748B"],
  upcoming: ["Not started", "#64748B"],
};
const NOW_STATUS = {
  working: ["Working", "#86EFAC"],
  "on-break": ["On break", "#FCD34D"],
  "auto-started": ["Auto-started (not logged in)", "#93C5FD"],
  "logged-out": ["Logged out", "#CBD5E1"],
  "not-logged-in": ["Not logged in", "#FCA5A5"],
};
const EVENT = {
  shift_login: ["Logged in", "#15803D"],
  shift_logout: ["Logged out", "#64748B"],
  auto_start: ["Dialer auto-started (11:00)", "#2563EB"],
  pool_on: ["Dialer on", "#15803D"],
  pool_off: ["Dialer off", "#64748B"],
  break_start: ["Break started", "#B45309"],
  break_end: ["Break ended", "#B45309"],
  leave_pause: ["Leave — dialer paused", "#7C3AED"],
  leave_applied: ["Leave applied", "#7C3AED"],
  leave_decided: ["Leave decided", "#7C3AED"],
};
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HEAT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const n = (v) => (v || 0).toLocaleString("en-IN");
const inr = (v) => `₹${Math.round(v || 0).toLocaleString("en-IN")}`;
const PAY_STATUS = { created: ["Link sent", "#B45309"], paid: ["Paid", "#15803D"], expired: ["Expired", "#64748B"], cancelled: ["Cancelled", "#64748B"], failed: ["Failed", "#B91C1C"] };
const STAGE_COLOR = {
  "New Lead": "#2563EB",
  "Invalid Leads": "#94A3B8",
  "No Response": "#FB923C",
  "Fresh Leads": "#22C55E",
  Callback: "#EC4899",
  "Connected Leads": "#06B6D4",
  "Demo Booking": "#6366F1",
  "Interested Leads": "#F97316",
  Prospects: "#10B981",
  "Future Prospect": "#14B8A6",
  "Not Interested Leads": "#EF4444",
  Enrolled: "#16A34A",
};
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const clock = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) : "—");
const clockSec = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—");
const hm = (min) => {
  const m = Math.round(min || 0);
  if (!m) return "0m";
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};
const dur = (sec) => {
  const s = Math.round(sec || 0);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};
const minClock = (m) => (m == null ? "—" : `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${m < 720 ? "AM" : "PM"}`);
const initials = (name) => (name || "?").split(" ").filter(Boolean).map((x) => x[0]).join("").slice(0, 2).toUpperCase();
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
const bucketLabel = (key, bucket) => {
  if (bucket === "hour") return dayjs(`${key.slice(0, 10)}T${key.slice(11)}:00`).format("h A");
  if (bucket === "month") return dayjs(`${key}-01`).format("MMM YY");
  return dayjs(key).format("D MMM");
};
const isConnected = (c) => !!(c.answeredAt && c.agentLegAnswered !== false && c.duration > 0);
// pool_on → pool_off pairs from a day's activity log (an open one runs to `end`)
// — the same rule the backend uses for dialerMin.
const dialerSpans = (events, end) => {
  const out = [];
  let on = null;
  for (const e of [...(events || [])].sort((a, b) => new Date(a.at) - new Date(b.at))) {
    if (e.kind === "pool_on" && !on) on = e.at;
    else if (e.kind === "pool_off" && on) {
      out.push({ startAt: on, endAt: e.at });
      on = null;
    }
  }
  if (on && end && new Date(end) > new Date(on)) out.push({ startAt: on, endAt: end });
  return out;
};
const spansMin = (spans) => spans.reduce((t, x) => t + Math.max(0, Math.round((new Date(x.endAt) - new Date(x.startAt)) / 60000)), 0);

// The hour window a day strip covers: 9 AM–8 PM, widened to whatever happened.
function dayWindow(dayKey, points) {
  const at = (hhmm) => new Date(`${dayKey}T${hhmm}:00+05:30`).getTime();
  const pts = points.filter(Boolean).map((d) => new Date(d).getTime());
  const t0 = Math.floor(Math.min(at("09:00"), ...pts) / 3600e3) * 3600e3;
  const t1 = Math.ceil(Math.max(at("20:00"), ...pts) / 3600e3) * 3600e3;
  return { t0, t1, span: t1 - t0 };
}

// Authenticated .xlsx download (blob — needs the auth header, not a link).
async function downloadFile(path, fallback) {
  const token = storePersist.get("auth")?.current?.token;
  try {
    const res = await axios.get(`${API_BASE_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, responseType: "blob" });
    const name = /filename="([^"]+)"/.exec(res.headers["content-disposition"] || "")?.[1] || fallback;
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    message.success("Downloaded.");
  } catch (err) {
    let msg = "Could not download.";
    try {
      msg = JSON.parse(await err.response.data.text()).message || msg;
    } catch (e) {
      /* keep the generic message */
    }
    message.error(msg);
  }
}

// ── recording player (one at a time per list) ───────────────────────────
function useRecording() {
  const [state, setState] = useState({ id: null, url: null, loading: false });
  const toggle = async (id) => {
    if (state.id === id) return setState({ id: null, url: null, loading: false });
    setState({ id, url: null, loading: true });
    const r = await request.get({ entity: `calling/recordings/${id}` });
    if (r?.success && r.result?.url) setState({ id, url: r.result.url, loading: false });
    else {
      message.warning("Recording isn't available for this call.");
      setState({ id: null, url: null, loading: false });
    }
  };
  return { state, toggle, stop: () => setState({ id: null, url: null, loading: false }) };
}

// A fixed-looking waveform per call (seeded by its id) — decoration only.
function Wave({ id, active }) {
  const bars = useMemo(() => {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return Array.from({ length: 26 }, (_, i) => 6 + (((h >> (i % 24)) + i * 7) % 18));
  }, [id]);
  return (
    <span className={`s3-wave ${active ? "on" : ""}`} aria-hidden="true">
      {bars.map((b, i) => <i key={i} style={{ height: b }} />)}
    </span>
  );
}

// ── small pieces ─────────────────────────────────────────────────────────
function Kpi({ icon, label, value, sub, color, tone, delta, i = 0, active, onOpen }) {
  return (
    <button type="button" className={`s3-kpi ${active ? "on" : ""}`} style={{ "--c": color, animationDelay: `${i * 30}ms` }} onClick={onOpen} aria-pressed={!!active} title={`Show ${label.toLowerCase()} in detail`}>
      <span className="s3-kpi-ico">{icon}</span>
      <div className="s3-kpi-txt">
        <b>{value}</b>
        <span>{label}</span>
        {sub && <small className={tone ? `t-${tone}` : ""}>{sub}</small>}
        {delta && <small className={`s3-kpi-delta ${delta.good == null ? "" : delta.good ? "t-up" : "t-down"}`}>{delta.text}</small>}
      </div>
    </button>
  );
}

// Every stage change behind a sales card (Demos / Interested / Enrolled …),
// newest first, with a sub-status filter.
function LeadLog({ base, stages, showUser }) {
  const stageKey = stages.join(","); // a fresh array each render — depend on its text
  const [sub, setSub] = useState("");
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState(25);
  const [data, setData] = useState(null);
  useEffect(() => setPage(1), [base, stageKey, sub, q, items]);
  useEffect(() => {
    let live = true;
    const p = new URLSearchParams({ ...base, page: String(page), items: String(items) });
    if (stageKey) p.set("stages", stageKey);
    if (sub) p.set("sub", sub);
    if (q) p.set("q", q);
    setData((d) => (d ? { ...d, loading: true } : d));
    request.get({ entity: `workday/admin/360/leads?${p}` }).then((r) => {
      if (live) setData(r?.success ? { rows: r.result, subs: r.subs, count: r.pagination.count, pages: r.pagination.pages } : { rows: [], subs: [], count: 0, pages: 0 });
    });
    return () => {
      live = false;
    };
  }, [base, stageKey, sub, q, page, items]);
  const total = (data?.subs || []).reduce((t, x) => t + x.n, 0);
  return (
    <>
      <div className="s3-detail-tools">
        <div className="s3-chips">
          <button type="button" className={!sub ? "on" : ""} onClick={() => setSub("")}>All <em>{n(total)}</em></button>
          {(data?.subs || []).map((x) => (
            <button key={x.key} type="button" className={sub === x.key ? "on" : ""} onClick={() => setSub(x.key)}>{x.key} <em>{n(x.n)}</em></button>
          ))}
        </div>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Lead name, phone or email"
          value={qDraft}
          onChange={(e) => {
            setQDraft(e.target.value);
            if (!e.target.value) setQ("");
          }}
          onPressEnter={() => setQ(qDraft.trim())}
          className="s3-detail-search"
        />
      </div>
      <div className={`hub-table-wrapper ${data?.loading ? "is-loading" : ""}`}>
        <table className="hub-table s3-table">
          <thead>
            <tr><th>When</th><th>Lead</th>{showUser && <th>User</th>}<th>Moved from</th><th>Moved to</th><th>Now</th><th>Remarks</th></tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={7}><div className="s3-skel-rows"><i /><i /></div></td></tr>}
            {data && !data.rows.length && <tr><td colSpan={7}><div className="s3-empty">Nothing in this range.</div></td></tr>}
            {(data?.rows || []).map((r) => (
              <tr key={`${r._id}-${r.at}`}>
                <td style={{ whiteSpace: "nowrap" }}>{when(r.at)}</td>
                <td><b>{r.name || "—"}</b><div className="s3-muted">{r.phone}</div></td>
                {showUser && <td>{r.by || "—"}</td>}
                <td className="s3-muted">{r.fromStage ? <>{r.fromStage}{r.fromSubStatus && r.fromSubStatus !== r.fromStage ? <div>{r.fromSubStatus}</div> : null}</> : "—"}</td>
                <td>
                  <Pill color={STAGE_COLOR[r.toStage] || "#64748B"}>{r.toStage}</Pill>
                  {r.toSubStatus && r.toSubStatus !== r.toStage && <div className="s3-muted">{r.toSubStatus}</div>}
                  {r.toSubStatus === "Demo Booked" && r.meetingAt && <div className="s3-muted">demo {when(r.meetingAt)}</div>}
                </td>
                <td>{r.stage === r.toStage ? <span className="s3-muted">same</span> : <Pill color={STAGE_COLOR[r.stage] || "#64748B"}>{r.stage}</Pill>}</td>
                <td className="s3-muted" style={{ maxWidth: 260 }}>{r.remarks || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="s3-pager">
        <span className="s3-muted">{data?.count ? `${(page - 1) * items + 1}–${Math.min(page * items, data.count)} of ${n(data.count)}` : ""}</span>
        <select className="hub-select" value={items} onChange={(e) => setItems(Number(e.target.value))} aria-label="Rows per page">
          {[10, 25, 50, 100, 200].map((x) => <option key={x} value={x}>{x} / page</option>)}
        </select>
        <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><LeftOutlined /></button>
        <span className="s3-muted">{page} / {data?.pages || 1}</span>
        <button type="button" className="hub-btn" disabled={!data || page >= data.pages} onClick={() => setPage(page + 1)} aria-label="Next page"><RightOutlined /></button>
      </div>
    </>
  );
}

function Panel({ title, icon, extra, children, className = "" }) {
  return (
    <section className={`s3-panel ${className}`}>
      <header>
        <h4>{icon} {title}</h4>
        {extra}
      </header>
      {children}
    </section>
  );
}

function Bars({ items, color, total, labelWidth = 112, empty = "Nothing yet", onPick, picked }) {
  const max = Math.max(1, ...items.map((x) => x.n));
  if (!items.length) return <div className="s3-empty">{empty}</div>;
  return (
    <div className="s3-bars">
      {items.map((x, i) => (
        <div
          key={x.key}
          className={`s3-bar ${onPick ? "s3-bar-pick" : ""} ${picked === x.key ? "on" : ""}`}
          style={{ "--c": x.color || color, gridTemplateColumns: `${labelWidth}px 1fr auto`, animationDelay: `${i * 40}ms` }}
          onClick={onPick ? () => onPick(x.key) : undefined}
          role={onPick ? "button" : undefined}
          tabIndex={onPick ? 0 : undefined}
          onKeyDown={onPick ? (e) => e.key === "Enter" && onPick(x.key) : undefined}
        >
          <span className="s3-bar-l" title={x.label || x.key}>{x.label || x.key}</span>
          <span className="s3-bar-t"><i style={{ width: `${(x.n / max) * 100}%` }} /></span>
          <span className="s3-bar-v">
            {n(x.n)}
            {total ? <em>{Math.round((x.n / total) * 100)}%</em> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function Heatmap({ heat }) {
  const max = Math.max(1, ...heat.flat().map((c) => c.calls));
  return (
    <div className="s3-heat">
      <div className="s3-heat-row s3-heat-head">
        <span />
        {HEAT_HOURS.map((h) => <span key={h}>{hourLabel(h)}</span>)}
      </div>
      {heat.map((row, d) => (
        <div key={d} className="s3-heat-row">
          <span>{WEEK[d]}</span>
          {HEAT_HOURS.map((h) => {
            const c = row[h];
            const a = c.calls ? 0.1 + (c.calls / max) * 0.9 : 0;
            return (
              <span key={h} className={`s3-heat-cell ${a > 0.5 ? "dark" : ""}`} style={{ "--a": a }} title={`${WEEK[d]} ${hourLabel(h)} — ${c.calls} calls, ${c.connected} connected`}>
                {c.calls || ""}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Pill({ color, children }) {
  return <span className="s3-pill" style={{ "--c": color }}>{children}</span>;
}

// ── attendance calendar (month grid — everyone, or the one picked user) ──
// Data: /workday/admin/360/attendance — same present / absent / late rules
// as the report above. Its own month, independent of the range picker.
const ATT = {
  present: ["Present", "#16A34A"],
  auto: ["Auto-started", "#2563EB"],
  absent: ["Absent", "#DC2626"],
  leave: ["Leave", "#7C3AED"],
  holiday: ["Holiday", "#DB2777"],
  "weekly-off": ["Weekly off", "#94A3B8"],
  upcoming: ["Not started", "#94A3B8"],
};

function AttendanceCalendar({ adminId, team, monthHint }) {
  const [month, setMonth] = useState(() => dayjs(monthHint || undefined).startOf("month"));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (monthHint) setMonth(dayjs(monthHint).startOf("month"));
  }, [monthHint]);
  // Live: a leave applied / approved / rejected / cancelled reloads the month.
  useEffect(() => {
    const socket = getSocket();
    const onNote = (doc) => {
      if (String(doc?.type || "").startsWith("leave.")) setTick((t) => t + 1);
    };
    socket?.on("notification:new", onNote);
    return () => socket?.off("notification:new", onNote);
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const p = new URLSearchParams({ month: month.format("YYYY-MM") });
    if (adminId) p.set("adminId", adminId);
    if (team && !adminId) p.set("team", team);
    request.get({ entity: `workday/admin/360/attendance?${p}` }).then((r) => {
      if (!live) return;
      setData(r?.success ? r.result : { days: [], people: [] });
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [month, adminId, team, tick]);

  const single = !!adminId && data?.people?.length === 1;
  const byKey = new Map((data?.days || []).map((d) => [d.dayKey, d]));
  const upKey = new Map((data?.upcoming || []).map((d) => [d.dayKey, d])); // days to come: leave requests only
  const LEAVE_ST = { Approved: ["✓", "#7C3AED"], Pending: ["⏳", "#B45309"], Rejected: ["✕", "#64748B"] };
  const leaveBadges = (leaves) =>
    leaves && leaves.length ? (
      <div className="s3-att-leaves">
        {single
          ? leaves.map((l, k) => (
              <span key={k} style={{ "--c": LEAVE_ST[l.status][1] }} className={l.status === "Rejected" ? "rej" : ""}>
                {LEAVE_ST[l.status][0]} Leave {l.status.toLowerCase()}
              </span>
            ))
          : ["Approved", "Pending", "Rejected"].map((s) => {
              const n = leaves.filter((l) => l.status === s).length;
              return n ? (
                <span key={s} style={{ "--c": LEAVE_ST[s][1] }} className={s === "Rejected" ? "rej" : ""}>
                  {LEAVE_ST[s][0]} {n} {s === "Approved" ? "on leave" : s.toLowerCase()}
                </span>
              ) : null;
            })}
      </div>
    ) : null;
  const leaveTip = (leaves) =>
    leaves && leaves.length ? (
      <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,.12)" }}>
        <span style={{ color: "#C4B5FD", fontWeight: 700 }}>Leave requests · {leaves.length}</span>
        {leaves.map((l, k) => (
          <div key={k} className="s3-att-names" style={{ marginTop: 2 }}>
            <b style={{ color: "#fff" }}>{l.name}</b> · {l.type} · <span style={{ color: LEAVE_ST[l.status][1] === "#64748B" ? "#94A3B8" : l.status === "Pending" ? "#FCD34D" : "#C4B5FD" }}>{l.status}</span>
            <div>{l.when}{l.reason ? ` — ${l.reason}` : ""}{l.decisionBy ? ` · by ${l.decisionBy}` : ""}</div>
          </div>
        ))}
      </div>
    ) : null;
  const first = month.startOf("month");
  const lead = (first.day() + 6) % 7; // Monday first
  const cells = [...Array(lead).fill(null), ...Array.from({ length: month.daysInMonth() }, (_, i) => first.add(i, "day"))];
  const isFuture = (d) => d.isAfter(dayjs(), "day");
  const sum = (k) => (data?.people || []).reduce((x, p) => x + (p[k] || 0), 0);
  const me = single ? data.people[0] : null;
  const pctOf = (p) => (p.workingDays ? Math.round(((p.present + p.auto) / p.workingDays) * 100) : 0);

  const dayTip = (d) => {
    if (!d) return null;
    if (!d.people) {
      return (
        <>
          <b>{dayjs(d.dayKey).format("ddd, D MMM")}</b>
          {leaveTip(d.leaves)}
        </>
      );
    }
    if (single) {
      const u = d.people[0];
      const st = ATT[u.status] || [u.status, "#64748B"];
      return (
        <>
          <b>{dayjs(d.dayKey).format("ddd, D MMM")}</b> · <span style={{ color: st[1] }}>{st[0]}</span>
          {d.holiday && <div>{d.holiday}</div>}
          {u.loginAt && <div>Login {dayjs(u.loginAt).format("h:mm A")}{u.logoutAt ? ` · logout ${dayjs(u.logoutAt).format("h:mm A")}` : ""}</div>}
          {u.lateMin > (data.lateAfterMin || 15) && <div style={{ color: "#B45309" }}>Late by {hm(u.lateMin)}</div>}
          {u.activeMin > 0 && <div>Active {hm(u.activeMin)}</div>}
          {leaveTip(d.leaves)}
        </>
      );
    }
    const groups = ["present", "auto", "leave", "absent"].map((k) => [k, d.people.filter((u) => u.status === k)]).filter(([, l]) => l.length);
    return (
      <>
        <b>{dayjs(d.dayKey).format("ddd, D MMM")}</b>
        {d.holiday && <div>{d.holiday}</div>}
        {groups.map(([k, l]) => (
          <div key={k} style={{ marginTop: 5 }}>
            <span style={{ color: ATT[k][1], fontWeight: 700 }}>{ATT[k][0]} · {l.length}</span>
            <div className="s3-att-names">
              {l.map((u) => `${u.name}${u.lateMin > (data.lateAfterMin || 15) ? ` (late ${hm(u.lateMin)})` : ""}`).join(", ")}
            </div>
          </div>
        ))}
        {leaveTip(d.leaves)}
      </>
    );
  };

  return (
    <Panel
      title={single ? `Attendance · ${me.name}` : "Attendance calendar"}
      icon={<CalendarOutlined />}
      extra={
        <div className="s3-att-nav">
          <button type="button" onClick={() => setMonth((m) => m.subtract(1, "month"))} aria-label="Previous month"><LeftOutlined /></button>
          <b>{month.format("MMMM YYYY")}</b>
          {/* up to 2 months ahead — for leave already applied for */}
          <button type="button" disabled={!month.isBefore(dayjs().add(2, "month"), "month")} onClick={() => setMonth((m) => m.add(1, "month"))} aria-label="Next month"><RightOutlined /></button>
        </div>
      }
    >
      <div className="s3-att-top">
        {single ? (
          <div className="s3-att-chips">
            <span style={{ "--c": ATT.present[1] }}><b>{me.present}</b> present</span>
            <span style={{ "--c": ATT.auto[1] }}><b>{me.auto}</b> auto-started</span>
            <span style={{ "--c": ATT.absent[1] }}><b>{me.absent}</b> absent</span>
            <span style={{ "--c": ATT.leave[1] }}><b>{me.leave}</b> leave</span>
            <span style={{ "--c": "#B45309" }}><b>{me.late}</b> late</span>
            <span style={{ "--c": "#0F172A" }}><b>{pctOf(me)}%</b> of {me.workingDays} working days</span>
          </div>
        ) : (
          <div className="s3-att-chips">
            <span style={{ "--c": "#0F172A" }}><b>{data?.people?.length || 0}</b> people</span>
            <span style={{ "--c": ATT.present[1] }}><b>{sum("present")}</b> present days</span>
            <span style={{ "--c": ATT.auto[1] }}><b>{sum("auto")}</b> auto-started</span>
            <span style={{ "--c": ATT.absent[1] }}><b>{sum("absent")}</b> absent</span>
            <span style={{ "--c": ATT.leave[1] }}><b>{sum("leave")}</b> leave</span>
            <span style={{ "--c": "#B45309" }}><b>{sum("late")}</b> late</span>
          </div>
        )}
        <div className="s3-att-legend">
          {["present", "auto", "absent", "leave", "holiday", "weekly-off"].map((k) => (
            <span key={k}><i style={{ background: ATT[k][1] }} />{ATT[k][0]}</span>
          ))}
        </div>
      </div>

      <div className={`s3-att-grid${loading ? " is-loading" : ""}`}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <div key={w} className="s3-att-wd">{w}</div>)}
        {cells.map((c, i) => {
          if (!c) return <div key={`b${i}`} className="s3-att-cell blank" />;
          const d = byKey.get(c.format("YYYY-MM-DD"));
          const future = isFuture(c) || !d;
          const today = c.isSame(dayjs(), "day");
          const up = !d ? upKey.get(c.format("YYYY-MM-DD")) : null;
          if (up) {
            return (
              <div key={i} className="s3-att-cell future has-leave" onMouseEnter={() => setHover(up)} onMouseLeave={() => setHover(null)}>
                <span className="s3-att-num">{c.date()}</span>
                {leaveBadges(up.leaves)}
                {hover === up && <div className="s3-att-tip">{dayTip(up)}</div>}
              </div>
            );
          }
          if (single && d) {
            const u = d.people[0];
            const st = ATT[u.status] || ["", "#94A3B8"];
            const late = u.lateMin > (data.lateAfterMin || 15);
            return (
              <div key={i} className={`s3-att-cell one${today ? " today" : ""}`} style={{ "--c": st[1] }} onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}>
                <span className="s3-att-num">{c.date()}</span>
                <span className="s3-att-status">{st[0]}</span>
                {u.loginAt && <span className="s3-att-time">{dayjs(u.loginAt).format("h:mm A")}</span>}
                {late && <span className="s3-att-late">late {hm(u.lateMin)}</span>}
                {leaveBadges(d.leaves)}
                {hover === d && <div className="s3-att-tip">{dayTip(d)}</div>}
              </div>
            );
          }
          const total = d ? d.people.length : 0;
          const off = d && !d.workingDay;
          return (
            <div key={i} className={`s3-att-cell${future ? " future" : ""}${off ? " off" : ""}${today ? " today" : ""}`} onMouseEnter={() => d && setHover(d)} onMouseLeave={() => setHover(null)}>
              <span className="s3-att-num">{c.date()}</span>
              {d && !future && (off && !d.present && !d.auto ? (
                <span className="s3-att-offlabel">{d.holiday || "Weekly off"}</span>
              ) : !(d.present + d.auto + d.absent + d.leave) ? (
                <span className="s3-att-offlabel">Not started yet</span>
              ) : (
                <>
                  <div className="s3-att-bar">
                    {["present", "auto", "leave", "absent"].map((k) => d[k] ? <i key={k} style={{ width: `${(d[k] / total) * 100}%`, background: ATT[k][1] }} /> : null)}
                  </div>
                  <div className="s3-att-counts">
                    <span style={{ color: ATT.present[1] }}>{d.present + d.auto}</span>
                    <span>/{total}</span>
                    {d.absent > 0 && <em style={{ color: ATT.absent[1] }}>{d.absent} absent</em>}
                  </div>
                  {d.late > 0 && <span className="s3-att-late">{d.late} late</span>}
                </>
              ))}
              {d && leaveBadges(d.leaves)}
              {hover === d && d && <div className="s3-att-tip">{dayTip(d)}</div>}
            </div>
          );
        })}
      </div>

      {!single && data?.people?.length > 0 && (
        <div className="hub-table-wrapper" style={{ marginTop: 16 }}>
          <table className="hub-table s3-table">
            <thead>
              <tr><th>User</th><th>Present</th><th>Auto-started</th><th>Absent</th><th>Leave</th><th>Late</th><th>Attendance</th></tr>
            </thead>
            <tbody>
              {[...data.people].sort((a, b) => pctOf(b) - pctOf(a)).map((p) => (
                <tr key={p.adminId}>
                  <td><b>{p.name}</b><div className="s3-muted">{p.role}{p.team ? ` · ${p.team}` : ""}</div></td>
                  <td style={{ color: ATT.present[1], fontWeight: 700 }}>{p.present}</td>
                  <td style={{ color: ATT.auto[1] }}>{p.auto}</td>
                  <td style={{ color: p.absent ? ATT.absent[1] : undefined, fontWeight: p.absent ? 700 : 400 }}>{p.absent}</td>
                  <td>
                    {p.leave}
                    {p.leaveRequests && (p.leaveRequests.pending > 0 || p.leaveRequests.rejected > 0) && (
                      <div className="s3-muted">
                        {p.leaveRequests.pending ? <span style={{ color: "#B45309" }}>{p.leaveRequests.pending} pending</span> : null}
                        {p.leaveRequests.pending && p.leaveRequests.rejected ? " · " : ""}
                        {p.leaveRequests.rejected ? `${p.leaveRequests.rejected} rejected` : null}
                      </div>
                    )}
                  </td>
                  <td>{p.late ? <span className="s3-warn">{p.late}</span> : 0}</td>
                  <td>
                    <div className="s3-att-pct"><i style={{ width: `${pctOf(p)}%` }} /></div>
                    <span className="s3-muted">{pctOf(p)}% of {p.workingDays} days</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="s3-note">Present = logged in · Auto-started = the dialer started at 11:00 without a login · Late = login more than {data?.lateAfterMin || 15} min after the shift start. Hover a day for names and times.</p>
    </Panel>
  );
}

// ── call list (table for the team, cards for one user) ───────────────────
function CallLog({ base, title, cards, initial }) {
  const [f, setF] = useState({ q: "", outcome: "", direction: "", recorded: false, ...initial });
  const [qDraft, setQDraft] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState(25);
  const [data, setData] = useState({ rows: [], count: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const rec = useRecording();

  useEffect(() => setPage(1), [base, f, items]);
  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      const p = new URLSearchParams({ ...base, page: String(page), items: String(items) });
      if (f.q) p.set("q", f.q);
      if (f.outcome) p.set("outcome", f.outcome);
      if (f.direction) p.set("direction", f.direction);
      if (f.recorded) p.set("recorded", "1");
      const r = await request.get({ entity: `workday/admin/360/calls?${p}` });
      if (!live) return;
      setData(r?.success ? { rows: r.result, count: r.pagination.count, pages: r.pagination.pages } : { rows: [], count: 0, pages: 0 });
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [base, f, page, items]);

  const exportCsv = () => {
    const cols = [["at", "Time"], ["user", "User"], ["name", "Contact"], ["phone", "Phone"], ["direction", "Type"], ["result", "Result"], ["talk", "Talk"], ["disposition", "Disposition"], ["stage", "Lead stage"], ["recording", "Recording"]].map(([key, label]) => ({ key, label }));
    const rows = data.rows.map((r) => ({ ...r, at: dayjs(r.at).format("D MMM YYYY, h:mm:ss A"), result: r.connected ? "Connected" : r.missed ? "Missed" : r.status, talk: r.talkSec ? dur(r.talkSec) : "" }));
    downloadCsv(`calls-page-${page}.csv`, rowsToCsv(rows, cols));
  };
  const result = (r) => (r.connected ? ["Connected", "#15803D"] : r.missed ? ["Missed", "#B91C1C"] : OUTCOME[r.status] || [r.status, "#64748B"]);
  const player = (r) =>
    rec.state.id === r._id && (
      <div className="s3-player">
        {rec.state.loading ? <span className="s3-muted">Loading recording…</span> : <audio controls autoPlay src={rec.state.url} />}
        {rec.state.url && <a href={rec.state.url} target="_blank" rel="noreferrer" className="hub-btn"><DownloadOutlined /> Download</a>}
        <button type="button" className="hub-btn" onClick={rec.stop} aria-label="Close player"><CloseOutlined /></button>
      </div>
    );

  return (
    <Panel
      title={`${title} · ${n(data.count)}`}
      icon={<PhoneOutlined />}
      extra={<button type="button" className="hub-btn" onClick={exportCsv} disabled={!data.rows.length}><DownloadOutlined /> CSV</button>}
    >
      <div className="s3-log-filters">
        <Input
          prefix={<SearchOutlined />}
          placeholder="Name, number or disposition — Enter"
          value={qDraft}
          allowClear
          onChange={(e) => {
            setQDraft(e.target.value);
            if (!e.target.value) setF((p) => ({ ...p, q: "" }));
          }}
          onPressEnter={() => setF((p) => ({ ...p, q: qDraft.trim() }))}
        />
        <div className="s3-chips">
          {[["", "All"], ["connected", "Connected"], ["not-connected", "Not connected"], ["missed", "Missed"]].map(([k, l]) => (
            <button key={k || "all"} type="button" className={f.outcome === k ? "on" : ""} onClick={() => setF({ ...f, outcome: k })}>{l}</button>
          ))}
          <span className="s3-chip-sep" />
          {[["", "Both"], ["Outbound", "Outgoing"], ["Inbound", "Incoming"]].map(([k, l]) => (
            <button key={k || "both"} type="button" className={f.direction === k ? "on" : ""} onClick={() => setF({ ...f, direction: k })}>{l}</button>
          ))}
          <span className="s3-chip-sep" />
          <button type="button" className={f.recorded ? "on" : ""} onClick={() => setF({ ...f, recorded: !f.recorded })}><AudioOutlined /> With recording</button>
        </div>
      </div>

      {loading && <div className="s3-skel-rows">{[0, 1, 2, 3].map((i) => <i key={i} />)}</div>}
      {!loading && !data.rows.length && <div className="s3-empty">No calls match.</div>}

      {!loading && data.rows.length > 0 && cards && (
        <div className="s3-callcards">
          {data.rows.map((r) => {
            const [label, color] = result(r);
            return (
              <div key={r._id} className={`s3-callcard ${rec.state.id === r._id ? "on" : ""}`}>
                <div className="s3-callcard-row">
                  <div className="s3-cc-time"><b>{clock(r.at)}</b><span>{dayjs(r.at).format("D MMM")}</span></div>
                  <div className="s3-cc-who">
                    <b>{r.name || "Unknown"}</b>
                    <span>{r.direction === "Inbound" ? "Incoming" : "Outgoing"} · {r.phone}{r.campaign ? ` · ${r.campaign}` : ""}</span>
                  </div>
                  <Pill color={color}>{label}</Pill>
                  <div className="s3-cc-talk"><b>{r.talkSec ? dur(r.talkSec) : "—"}</b><span>{[r.disposition, r.stage].filter(Boolean).join(" → ") || "—"}</span></div>
                  <div className="s3-cc-rec">
                    {r.recording === "available" ? (
                      <>
                        <button type="button" className="s3-roundplay" onClick={() => rec.toggle(r._id)} aria-label={rec.state.id === r._id ? "Stop recording" : "Play recording"}>
                          {rec.state.id === r._id ? <PauseCircleFilled /> : <PlayCircleFilled />}
                        </button>
                        <Wave id={r._id} active={rec.state.id === r._id} />
                      </>
                    ) : (
                      <span className="s3-muted">{r.recording === "processing" ? "Processing…" : "No recording"}</span>
                    )}
                  </div>
                </div>
                {player(r)}
              </div>
            );
          })}
        </div>
      )}

      {!loading && data.rows.length > 0 && !cards && (
        <div className="hub-table-wrapper">
          <table className="hub-table s3-table">
            <thead>
              <tr><th>When</th><th>User</th><th>Contact</th><th>Result</th><th>Talk</th><th>Disposition / stage</th><th>Recording</th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const [label, color] = result(r);
                return (
                  <React.Fragment key={r._id}>
                    <tr className={rec.state.id === r._id ? "s3-playing" : ""}>
                      <td style={{ whiteSpace: "nowrap" }}><b>{dayjs(r.at).format("D MMM")}</b><div className="s3-muted">{clockSec(r.at)}</div></td>
                      <td>{r.user || "—"}</td>
                      <td><b>{r.name || "Unknown"}</b><div className="s3-muted">{r.direction === "Inbound" ? "Incoming" : "Outgoing"} · {r.phone}</div></td>
                      <td><Pill color={color}>{label}</Pill></td>
                      <td style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{r.talkSec ? dur(r.talkSec) : "—"}</td>
                      <td style={{ maxWidth: 260 }}>
                        {r.disposition && <div>{r.disposition}</div>}
                        {r.stage && <div className="s3-muted">{r.stage}</div>}
                        {!r.disposition && !r.stage && "—"}
                      </td>
                      <td>
                        {r.recording === "available" ? (
                          <button type="button" className={`s3-play ${rec.state.id === r._id ? "on" : ""}`} onClick={() => rec.toggle(r._id)} aria-label={rec.state.id === r._id ? "Stop recording" : "Play recording"}>
                            {rec.state.id === r._id ? <PauseCircleFilled /> : <PlayCircleFilled />} {r.recordingSec ? dur(r.recordingSec) : "Play"}
                          </button>
                        ) : (
                          <span className="s3-muted">{r.recording === "processing" ? "Processing…" : "—"}</span>
                        )}
                      </td>
                    </tr>
                    {rec.state.id === r._id && (
                      <tr className="s3-player-row"><td colSpan={7}>{player(r)}</td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="s3-pager">
        <span className="s3-muted">{data.count ? `${(page - 1) * items + 1}–${Math.min(page * items, data.count)} of ${n(data.count)}` : ""}</span>
        <select className="hub-select" value={items} onChange={(e) => setItems(Number(e.target.value))} aria-label="Rows per page">
          {[10, 25, 50, 100, 200].map((s) => <option key={s} value={s}>{s} / page</option>)}
        </select>
        <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><LeftOutlined /></button>
        <span className="s3-muted">{page} / {data.pages || 1}</span>
        <button type="button" className="hub-btn" disabled={page >= data.pages} onClick={() => setPage(page + 1)} aria-label="Next page"><RightOutlined /></button>
      </div>
    </Panel>
  );
}

// ── the day strip (work band, breaks, every call) ────────────────────────
function Strip({ day, calls, breaks, dialer = [], onHover, compact }) {
  const end = day.endAt || day.logoutAt || (day.dayKey === dayjs().format("YYYY-MM-DD") ? new Date() : null);
  const start = day.loginAt || day.autoStartedAt;
  const { t0, t1, span } = dayWindow(day.dayKey, [start, end, ...calls.map((c) => c.created)]);
  const x = (d) => `${((new Date(d).getTime() - t0) / span) * 100}%`;
  const w = (a, b) => `${Math.max(0.15, ((new Date(b).getTime() - new Date(a).getTime()) / span) * 100)}%`;
  const ticks = [];
  for (let t = t0; t <= t1; t += 3600e3) ticks.push(t);
  return (
    <div className={`s3-strip-wrap ${compact ? "compact" : ""}`}>
      <div className="s3-strip" onMouseLeave={() => onHover && onHover(null)}>
        {ticks.map((t) => <span key={t} className="s3-strip-tick" style={{ left: x(t) }} />)}
        {start && end && <span className="s3-strip-work" style={{ left: x(start), width: w(start, end) }} />}
        {dialer.map((d, i) => (
          <span key={`d${i}`} className="s3-strip-dialer" style={{ left: x(d.startAt), width: w(d.startAt, d.endAt) }} onMouseEnter={() => onHover && onHover({ k: "d", d })} />
        ))}
        {breaks.map((b, i) => (
          <span key={i} className="s3-strip-break" style={{ left: x(b.startAt), width: w(b.startAt, b.endAt || new Date()) }} onMouseEnter={() => onHover && onHover({ k: "b", b })} />
        ))}
        {calls.map((c) => {
          const ok = isConnected(c);
          const e = c.endedAt || new Date(new Date(c.created).getTime() + (c.duration || 0) * 1000);
          return (
            <span
              key={c._id}
              className={`s3-strip-call ${ok ? "ok" : c.missedByAgent ? "miss" : "no"}`}
              style={{ left: x(c.created), width: ok ? w(c.created, e) : undefined }}
              onMouseEnter={() => onHover && onHover({ k: "c", c })}
            />
          );
        })}
        {day.loginAt && !compact && <span className="s3-strip-flag" style={{ left: x(day.loginAt) }}>Login {clock(day.loginAt)}</span>}
        {day.logoutAt && !compact && <span className="s3-strip-flag out" style={{ left: x(day.logoutAt) }}>Logout {clock(day.logoutAt)}</span>}
      </div>
      <div className="s3-strip-axis">
        {ticks.map((t) => <span key={t} style={{ left: x(t) }}>{dayjs(t).format("h A")}</span>)}
      </div>
    </div>
  );
}

function StripLegend() {
  return (
    <div className="s3-strip-legend">
      <span><i className="lg-miss" /> Missed · top row</span>
      <span><i className="lg-no" /> Not connected · top row</span>
      <span><i className="lg-ok" /> Connected call · width = talk time</span>
      <span><i className="lg-dialer" /> Dialer on · bottom line</span>
      <span><i className="lg-work" /> Working</span>
      <span><i className="lg-break" /> Break</span>
    </div>
  );
}

// ── one day, minute by minute (modal) ────────────────────────────────────
function DayModal({ target, onClose }) {
  const [data, setData] = useState(null);
  const [hover, setHover] = useState(null);
  const [filter, setFilter] = useState("all");
  const rec = useRecording();
  useEffect(() => {
    if (!target) return;
    setData(null);
    setHover(null);
    setFilter("all");
    rec.stop();
    request.get({ entity: `workday/admin/timeline?adminId=${target.user.adminId}&date=${target.day.dayKey}` }).then((r) => setData(r?.success ? r.result : { events: [], calls: [], responses: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  if (!target) return null;
  const { day, user } = target;
  const calls = data?.calls || [];
  const conn = calls.filter(isConnected);
  const talkSec = conn.reduce((t, c) => t + c.duration, 0);
  const missed = calls.filter((c) => c.missedByAgent);
  const st = DAY_STATUS[day.status] || [day.status, "#64748B"];
  const dialer = dialerSpans(data?.events, day.endAt);
  const dialerMin = Math.min(day.activeMin || 0, spansMin(dialer));

  // hourly cards over the strip's window
  const { t0, t1 } = dayWindow(day.dayKey, [day.loginAt, day.autoStartedAt, day.endAt, ...calls.map((c) => c.created)]);
  const hours = [];
  for (let t = t0; t < t1; t += 3600e3) {
    const inH = calls.filter((c) => new Date(c.created).getTime() >= t && new Date(c.created).getTime() < t + 3600e3);
    hours.push({ t, n: inH.length, talk: inH.filter(isConnected).reduce((s, c) => s + c.duration, 0) });
  }
  const maxH = Math.max(1, ...hours.map((h) => h.n));

  const events = [
    ...(data?.events || []).map((e) => ({ at: e.at, kind: "activity", color: (EVENT[e.kind] || [0, "#64748B"])[1], title: (EVENT[e.kind] || [e.kind])[0], sub: [e.detail, e.byName && e.byName !== user.name ? `by ${e.byName}` : null].filter(Boolean).join(" · ") })),
    ...calls.map((c) => {
      const ok = isConnected(c);
      return {
        at: c.created,
        kind: c.missedByAgent ? "missed" : "call",
        id: c._id,
        rec: c.recording?.status === "available",
        color: ok ? "#15803D" : c.missedByAgent ? "#B91C1C" : "#94A3B8",
        title: `Call · ${c.contactName || c.phone}`,
        sub: `${c.direction === "Inbound" ? "Incoming" : "Outgoing"} · ${c.phone} · ${ok ? `talked ${dur(c.duration)}` : c.missedByAgent ? "missed by user — rang, not picked" : `not connected (${c.status})`}${c.disposition ? ` · ${c.disposition}` : ""}`,
      };
    }),
    ...(data?.responses || []).map((r) => ({ at: r.at, kind: "response", color: "#C2410C", title: `Response · ${r.name || r.phone}`, sub: `${r.fromStage ? `${r.fromStage} → ` : ""}${r.toStage}${r.toSubStatus ? ` (${r.toSubStatus})` : ""}${r.remarks ? ` · ${r.remarks}` : ""}` })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  const counts = { all: events.length, call: calls.length, activity: events.filter((e) => e.kind === "activity").length, response: (data?.responses || []).length, missed: missed.length };
  const shown = events.filter((e) => filter === "all" || (filter === "call" ? e.kind === "call" || e.kind === "missed" : e.kind === filter));
  const hc = hover?.k === "c" ? hover.c : null;

  return (
    <Modal open onCancel={onClose} footer={null} width={1000} closable={false} destroyOnClose className="wm-modal s3-modal" styles={{ content: { padding: 0, overflow: "hidden", borderRadius: 20 } }}>
      <div className="s3-day-head">
        <span className="s3-avatar">{initials(user.name)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2>{user.name}</h2>
          <p>{dayjs(day.dayKey).format("dddd, D MMMM YYYY")} · minute by minute</p>
        </div>
        <span className="s3-day-status" style={{ "--c": st[1] }}>{st[0]}{day.lateMin > 15 ? ` · late ${hm(day.lateMin)}` : ""}{day.derived ? " · from dialer" : ""}</span>
        <button type="button" className="s3-day-close" onClick={onClose} aria-label="Close"><CloseOutlined /></button>
      </div>
      <div className="s3-day-body">
        <div className="s3-day-stats">
          {[
            ["Login", day.loginAt ? clock(day.loginAt) : day.autoStartedAt ? `auto ${clock(day.autoStartedAt)}` : "—", day.lateMin > 15 ? `late ${hm(day.lateMin)}` : day.loginAt ? "on time" : ""],
            ["Logout", day.logoutAt ? clock(day.logoutAt) : day.loginAt || day.autoStartedAt ? "no logout" : "—", !day.logoutAt && day.endAt ? `counted to ${clock(day.endAt)}` : ""],
            ["Active", hm(day.activeMin), data ? `dialer on ${hm(dialerMin)} · break ${hm(day.breakMin)}` : `${hm(day.breakMin)} break`],
            ["Calls", n(calls.length), `${conn.length} connected · ${missed.length} missed`],
            ["Talk", dur(talkSec), conn.length ? `avg ${dur(talkSec / conn.length)}` : "—"],
            ["On phone", day.activeMin ? `${Math.round((talkSec / 60 / day.activeMin) * 100)}%` : "—", "of active time"],
          ].map(([k, v, s], i) => (
            <div key={k} style={{ animationDelay: `${i * 35}ms` }}><span>{k}</span><b>{v}</b><small>{s}</small></div>
          ))}
        </div>

        <StripLegend />
        <Strip day={day} calls={calls} breaks={day.breaks || []} dialer={dialer} onHover={setHover} />
        <div className="s3-hoverbar">
          {!hover && <span className="s3-hoverbar-hint">Hover the strip to see each call and break to the second.</span>}
          {hc && (
            <>
              <b>{clockSec(hc.created)}</b>
              <span>{hc.contactName || hc.phone} · {hc.phone} · {isConnected(hc) ? `talked ${dur(hc.duration)}` : hc.missedByAgent ? "missed by user" : hc.status}{hc.disposition ? ` · ${hc.disposition}` : ""}</span>
              {hc.recording?.status === "available" && (
                <button type="button" onClick={() => rec.toggle(hc._id)}>{rec.state.id === hc._id ? "Stop" : "Play recording"}</button>
              )}
            </>
          )}
          {hover?.k === "d" && (
            <>
              <b>Dialer on</b>
              <span>{clockSec(hover.d.startAt)} – {clockSec(hover.d.endAt)} · {spansMin([hover.d])}m in the calling pool</span>
            </>
          )}
          {hover?.k === "b" && (
            <>
              <b>{hover.b.label}</b>
              <span>{clockSec(hover.b.startAt)} – {hover.b.endAt ? clockSec(hover.b.endAt) : "now"} · {hover.b.minutes}m</span>
            </>
          )}
        </div>
        {hc && rec.state.id === hc._id && rec.state.url && <audio className="s3-hover-audio" controls autoPlay src={rec.state.url} />}

        <div className="s3-hourly">
          {hours.map((h) => (
            <div key={h.t} className={!h.n ? "empty" : h.n === maxH ? "peak" : ""} title={h.n === maxH && h.n ? "Busiest hour" : undefined}>
              <span>{dayjs(h.t).format("h A")}</span>
              <b>{h.n || "—"}</b>
              <i><em style={{ width: `${(h.n / maxH) * 100}%` }} /></i>
              <small>{h.talk ? (h.talk < 60 ? "<1m talk" : `${Math.round(h.talk / 60)}m talk`) : ""}</small>
            </div>
          ))}
        </div>

        <div className="s3-chips" style={{ margin: "14px 0 10px" }}>
          {[["all", "Everything"], ["call", "Calls"], ["activity", "Activity"], ["response", "Responses"], ["missed", "Missed"]].map(([k, l]) => (
            <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l} <em>{counts[k]}</em></button>
          ))}
        </div>
        <div className="s3-day-list">
          {!data && <div className="s3-skel-rows">{[0, 1, 2].map((i) => <i key={i} />)}</div>}
          {data && !shown.length && <div className="s3-empty">Nothing recorded for this filter.</div>}
          {shown.map((e, i) => (
            <div key={`${e.kind}-${e.id || i}`} className="s3-day-item">
              <time>{clockSec(e.at)}</time>
              <span className="s3-dot" style={{ "--c": e.color }} />
              <div className="s3-day-item-txt">
                <b>{e.title}</b>
                <span>{e.sub}</span>
                {e.id && rec.state.id === e.id && rec.state.url && <audio controls autoPlay src={rec.state.url} />}
              </div>
              {e.rec && (
                <button type="button" className="s3-roundplay sm" onClick={() => rec.toggle(e.id)} aria-label={rec.state.id === e.id ? "Stop recording" : "Play recording"}>
                  {rec.state.id === e.id ? <PauseCircleFilled /> : <PlayCircleFilled />}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ── "Today at a glance" (one user) ───────────────────────────────────────
function TodayGlance({ user, onOpen, tick }) {
  const [data, setData] = useState(null);
  const today = dayjs().format("YYYY-MM-DD");
  useEffect(() => {
    request.get({ entity: `workday/admin/timeline?adminId=${user.adminId}&date=${today}` }).then((r) => setData(r?.success ? r.result : null));
  }, [user.adminId, today, tick]);
  const s = data?.session;
  const now = new Date();
  const breaks = (s?.breaks || []).map((b) => ({ label: b.label, startAt: b.startAt, endAt: b.endAt || null, minutes: Math.round(((b.endAt ? new Date(b.endAt) : now) - new Date(b.startAt)) / 60000) }));
  const breakMin = breaks.reduce((t, b) => t + b.minutes, 0);
  const start = s?.loginAt || s?.autoStartedAt;
  const endAt = s?.logoutAt || (start ? now : null);
  const activeMin = start ? Math.max(0, Math.round((new Date(endAt) - new Date(start)) / 60000) - breakMin) : 0;
  const lateMin = s?.loginAt ? Math.max(0, Math.round((new Date(s.loginAt) - new Date(`${today}T10:00:00+05:30`)) / 60000)) : 0;
  const day = { dayKey: today, loginAt: s?.loginAt, autoStartedAt: s?.autoStartedAt, logoutAt: s?.logoutAt, endAt, breaks, breakMin, activeMin, lateMin, status: s?.loginAt ? "present" : s?.autoStartedAt ? "auto" : "absent" };
  const calls = data?.calls || [];
  const conn = calls.filter(isConnected);
  const dialer = dialerSpans(data?.events, endAt);
  return (
    <Panel
      title={`Today at a glance · ${dayjs().format("D MMM")}`}
      icon={<FieldTimeOutlined />}
      extra={<button type="button" className="s3-link" onClick={() => onOpen(day)}>Open minute-by-minute →</button>}
    >
      <div className="s3-glance-facts">
        <span>Login <b>{s?.loginAt ? clock(s.loginAt) : s?.autoStartedAt ? `auto ${clock(s.autoStartedAt)}` : "—"}</b></span>
        <span>Active <b>{hm(activeMin)}</b></span>
        <span>Dialer on <b>{hm(Math.min(activeMin, spansMin(dialer)))}</b></span>
        <span>Break <b>{hm(breakMin)}</b></span>
        <span>Calls <b>{calls.length}</b></span>
        <span>Connected <b>{conn.length}</b></span>
        <span>Talk <b>{dur(conn.reduce((t, c) => t + c.duration, 0))}</b></span>
      </div>
      {data ? <Strip day={day} calls={calls} breaks={breaks} dialer={dialer} compact /> : <div className="s3-skel-rows"><i /></div>}
    </Panel>
  );
}

// ── Used leads (took over Sales › Dashboard › Leads Analytics) ───────────
// Used = a number dialled in the range (same meaning as Leads › Used Leads).
const LEAD_KPIS = {
  total: ["Used leads", "#2563EB"],
  connected: ["Connected", "#0E7490"],
  qualified: ["Qualified", "#7C3AED"],
  meetings: ["Demo booked", "#6366F1"],
  enrolled: ["Enrolled", "#16A34A"],
  notInterested: ["Not interested", "#DC2626", true],
  noResponse: ["No response", "#EA580C", true],
  invalid: ["Invalid / junk", "#64748B", true],
};
const LEAD_HINT = {
  connected: "numbers where the customer answered at least once",
  qualified: "leads that ever reached Interested / Demo / Prospects / Enrolled",
  meetings: "leads that ever reached Demo Booking / Prospects / Enrolled",
  enrolled: "leads that ever reached Enrolled",
  notInterested: "lead stage now: Not Interested",
  noResponse: "lead stage now: No Response",
  invalid: "lead stage now: Invalid",
};

function Spark({ data, color }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${28 - (v / max) * 24}`).join(" ");
  return (
    <svg className="s3-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,30 ${pts} 100,30`} fill={color} opacity="0.12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function LeadsSection({ base, who }) {
  const [rep, setRep] = useState(null);
  const [pick, setPick] = useState({}); // { kpi | stage | source | teamPick | by }
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState(25);
  const [list, setList] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    let live = true;
    setRep(null);
    setPick({});
    request.get({ entity: `workday/admin/360/leads-report?${new URLSearchParams(base)}` }).then((r) => live && setRep(r?.success ? r.result : { kpis: [], trend: [], funnel: [], bySource: [], byStage: [], byTeam: [], byUser: [] }));
    return () => {
      live = false;
    };
  }, [base]);
  useEffect(() => setPage(1), [base, pick, q, items]);
  useEffect(() => {
    let live = true;
    const p = new URLSearchParams({ ...base, page: String(page), items: String(items), ...pick });
    if (q) p.set("q", q);
    setList((d) => (d ? { ...d, loading: true } : d));
    request.get({ entity: `workday/admin/360/lead-list?${p}` }).then((r) => {
      if (live) setList(r?.success ? { rows: r.result, count: r.pagination.count, pages: r.pagination.pages } : { rows: [], count: 0, pages: 0 });
    });
    return () => {
      live = false;
    };
  }, [base, pick, q, page, items]);

  const choose = (next) => {
    const same = Object.keys(next).every((k) => pick[k] === next[k]) && Object.keys(next).length === Object.keys(pick).length;
    setPick(same ? {} : next);
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const pickLabel = pick.kpi ? LEAD_KPIS[pick.kpi][0] : pick.stage ? `Stage: ${pick.stage}` : pick.source ? `Source: ${pick.source}` : pick.teamPick ? `Team: ${pick.teamPick}` : pick.by ? `Last called by: ${pick.by}` : "All used leads";
  const total = rep?.kpis?.[0]?.value;
  const trendData = {
    labels: (rep?.trend || []).map((x) => x.key.length > 10 ? dayjs(`${x.key.slice(0, 10)}T${x.key.slice(11)}:00`).format("h A") : x.key.length === 7 ? dayjs(`${x.key}-01`).format("MMM YY") : dayjs(x.key).format("D MMM")),
    datasets: [{ type: "line", label: "Numbers called", data: (rep?.trend || []).map((x) => x.n), borderColor: PALETTE.blue, backgroundColor: fillRgba(PALETTE.blue, 0.15), fill: true, tension: 0.35, pointRadius: 2 }],
  };

  return (
    <>
      <div className="s3-section"><FunnelPlotOutlined /> Used leads <span>{who} — numbers called in this range, with what each lead is now · ▲▼ vs previous period</span></div>
      {rep && total === 0 && <div className="s3-alert">No number was called in this range.</div>}
      {rep && rep.notInCrm > 0 && <p className="s3-note" style={{ margin: 0 }}>{n(rep.notInCrm)} of the numbers called aren't leads in the CRM — they count as used, but have no stage.</p>}
      <div className={`s3-lkpis ${!rep ? "is-loading" : ""}`}>
        {(rep?.kpis || Object.keys(LEAD_KPIS).map((key) => ({ key }))).map((k, i) => {
          const [label, color, downGood] = LEAD_KPIS[k.key];
          // the count's % change for "Used leads", percentage points for the ratios
          const isTotal = k.key === "total";
          const ch = !k.prevTotal ? null : isTotal ? Math.round(((k.value - k.prev) / k.prev) * 1000) / 10 : Math.round((k.pct - k.prevPct) * 10) / 10;
          const good = ch == null || ch === 0 ? null : downGood ? ch < 0 : ch > 0;
          const clickable = !isTotal;
          return (
            <button
              key={k.key}
              type="button"
              className={`s3-lkpi ${pick.kpi === k.key || (k.key === "total" && !Object.keys(pick).length) ? "on" : ""}`}
              style={{ "--c": color, animationDelay: `${i * 30}ms` }}
              onClick={() => (clickable ? choose({ kpi: k.key }) : choose({}))}
              title={LEAD_HINT[k.key]}
            >
              <span>{label}</span>
              <b>
                {k.value == null ? "—" : n(k.value)}
                {!isTotal && k.value != null && <em className="s3-lkpi-pct">{k.pct}%</em>}
              </b>
              <small>
                {k.value == null ? "" : ch == null ? <em className="s3-muted">no calls last period</em> : ch === 0 ? <em className="s3-muted">• same</em> : <em className={good ? "t-up" : "t-down"}>{ch > 0 ? "▲" : "▼"} {Math.abs(ch)}{isTotal ? "%" : " pp"}</em>}
                {k.prevTotal ? <> vs {isTotal ? n(k.prev) : `${k.prevPct}%`}</> : null}
              </small>
              <Spark data={k.series} color={color} />
            </button>
          );
        })}
      </div>

      <div className="s3-grid">
        <Panel title="Used leads · new numbers called" icon={<PhoneOutlined />} className="s3-span2">
          {rep ? <ChartCanvas type="line" data={trendData} options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: PALETTE.grid } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 14, maxRotation: 0 } } } }} height={240} /> : <div className="s3-skel-rows"><i /><i /></div>}
        </Panel>
        <Panel title="Leads by source" icon={<AimOutlined />} extra={<span className="s3-muted">click to list</span>}>
          <Bars items={rep?.bySource || []} color="#2563EB" total={total} labelWidth={110} empty="No leads" onPick={(k) => choose({ source: k })} picked={pick.source} />
        </Panel>
        <Panel title="Leads by stage · now" icon={<FormOutlined />} extra={<span className="s3-muted">click to list</span>}>
          <Bars items={(rep?.byStage || []).map((x) => ({ ...x, color: STAGE_COLOR[x.key] }))} total={total} labelWidth={140} empty="No leads" onPick={(k) => choose({ stage: k })} picked={pick.stage} />
        </Panel>
        <Panel title="Leads by team" icon={<TeamOutlined />}>
          <Bars items={rep?.byTeam || []} color="#0E7490" total={total} labelWidth={110} empty="No leads" onPick={(k) => choose({ teamPick: k })} picked={pick.teamPick} />
        </Panel>
        <Panel title="Used leads by user · last called by" icon={<TeamOutlined />}>
          <Bars items={rep?.byUser || []} color="#7C3AED" total={total} labelWidth={160} empty="No leads" onPick={(k) => choose({ by: k })} picked={pick.by} />
        </Panel>
      </div>

      <section ref={listRef} className="s3-panel s3-detail" style={{ "--c": "#2563EB" }}>
        <header>
          <h4><span className="s3-detail-ico"><FormOutlined /></span> {pickLabel} {list ? <span className="s3-muted">· {n(list.count)}</span> : null}</h4>
          {Object.keys(pick).length > 0 && <button type="button" className="hub-btn" onClick={() => setPick({})}>Show all used leads</button>}
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Name, phone or email"
            value={qDraft}
            onChange={(e) => {
              setQDraft(e.target.value);
              if (!e.target.value) setQ("");
            }}
            onPressEnter={() => setQ(qDraft.trim())}
            className="s3-detail-search"
          />
        </header>
        <div className={`hub-table-wrapper ${list?.loading ? "is-loading" : ""}`}>
          <table className="hub-table s3-table">
            <thead>
              <tr><th>Lead</th><th>Source</th><th>Stage now</th><th>Calls</th><th>Last called by</th><th>Last call</th><th>Next follow-up</th></tr>
            </thead>
            <tbody>
              {!list && <tr><td colSpan={7}><div className="s3-skel-rows"><i /><i /></div></td></tr>}
              {list && !list.rows.length && <tr><td colSpan={7}><div className="s3-empty">No used lead for this filter.</div></td></tr>}
              {(list?.rows || []).map((l) => (
                <tr key={l.key}>
                  <td><b>{l.name || "—"}</b><div className="s3-muted">{l.phone}</div></td>
                  <td>{l.source}</td>
                  <td>
                    <Pill color={STAGE_COLOR[l.stage] || "#64748B"}>{l.stage}</Pill>
                    {l.subStatus && l.subStatus !== l.stage && <div className="s3-muted" style={{ maxWidth: 240 }}>{l.subStatus}</div>}
                  </td>
                  <td><b>{l.calls}</b> <span className={l.connected ? "t-up" : "s3-muted"}>{l.connected ? "· connected" : "· never picked"}</span></td>
                  <td>{l.by}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{when(l.lastAt)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{l.nextFollowUpAt ? when(l.nextFollowUpAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="s3-pager">
          <span className="s3-muted">{list?.count ? `${(page - 1) * items + 1}–${Math.min(page * items, list.count)} of ${n(list.count)}` : ""}</span>
          <select className="hub-select" value={items} onChange={(e) => setItems(Number(e.target.value))} aria-label="Rows per page">
            {[10, 25, 50, 100, 200].map((x) => <option key={x} value={x}>{x} / page</option>)}
          </select>
          <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><LeftOutlined /></button>
          <span className="s3-muted">{page} / {list?.pages || 1}</span>
          <button type="button" className="hub-btn" disabled={!list || page >= list.pages} onClick={() => setPage(page + 1)} aria-label="Next page"><RightOutlined /></button>
        </div>
      </section>
    </>
  );
}

// ── main ─────────────────────────────────────────────────────────────────
export default function Sales360({ initialUser }) {
  const me = useSelector(selectCurrentAdmin);
  const manager = FULL_ACCESS.includes(me?.role);
  const [preset, setPreset] = useState("today");
  const [range, setRange] = useState(PRESETS[0].range());
  const [userId, setUserId] = useState(initialUser || "");
  const [team, setTeam] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: "calls", dir: -1 });
  const [dayOpen, setDayOpen] = useState(null);
  const [tick, setTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [focus, setFocus] = useState(null); // KPI card whose detail is open below
  const detailRef = useRef(null);
  useEffect(() => {
    if (!focus) return;
    const id = setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    return () => clearTimeout(id);
  }, [focus]);

  useEffect(() => {
    if (initialUser) setUserId(initialUser);
  }, [initialUser]);
  // Not management: always (and only) your own 360°.
  const effectiveUser = manager ? userId : String(me?._id || "");

  const base = useMemo(() => {
    const p = { from: range[0].toISOString(), to: range[1].toISOString() };
    if (effectiveUser) p.adminId = effectiveUser;
    if (team && !effectiveUser) p.team = team;
    return p;
  }, [range, effectiveUser, team]);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      const r = await request.get({ entity: `workday/admin/360?${new URLSearchParams(base)}` });
      if (!live) return;
      if (r?.success) setData(r.result);
      else message.error(r?.message || "Could not load the report.");
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [base, tick]);

  const pick = (p) => {
    setPreset(p.key);
    setRange(p.range());
  };
  // Refresh re-reads the preset so "Today" / "7 days" run up to this minute.
  const refresh = () => {
    const p = PRESETS.find((x) => x.key === preset);
    if (p) setRange(p.range());
    setTick((x) => x + 1);
  };
  const exportXlsx = async () => {
    setExporting(true);
    await downloadFile(`workday/admin/360/export?${new URLSearchParams(base)}`, "sales-360.xlsx");
    setExporting(false);
  };

  const t = data?.totals || {};
  const one = effectiveUser && data?.days && data.rows?.length === 1 ? data.rows[0] : null;
  // A one-day range on one user: the hero shows that day's own facts.
  const oneDay = one && data.days.length === 1 ? data.days[0] : null;
  const rows = useMemo(() => {
    const r = (data?.rows || []).map((x) => ({
      ...x,
      demoBooked: x.sales?.demoBooked || 0,
      interestedAll: (x.sales?.interested || 0) + (x.sales?.prospects || 0),
      enrolled: x.sales?.enrolled || 0,
      collected: x.pay?.collected || 0,
    }));
    r.sort((a, b) => ((a[sort.key] ?? "") > (b[sort.key] ?? "") ? 1 : (a[sort.key] ?? "") < (b[sort.key] ?? "") ? -1 : 0) * sort.dir);
    return r;
  }, [data, sort]);
  const rangeText = `${range[0].format("D MMM YYYY, h:mm A")} → ${range[1].format("D MMM YYYY, h:mm A")}`;
  const days = data?.range?.days || 0;

  const trendData = useMemo(() => {
    const tr = data?.trend || [];
    return {
      labels: tr.map((x) => bucketLabel(x.key, data.range.bucket)),
      datasets: [
        { type: "line", label: "Talk (min)", data: tr.map((x) => Math.round(x.talkSec / 60)), borderColor: "#C2410C", backgroundColor: "#C2410C", tension: 0.35, pointRadius: tr.length > 40 ? 0 : 3, yAxisID: "y1", order: 0 },
        { type: "bar", id: "connected", label: "Connected", data: tr.map((x) => x.connected), backgroundColor: "#4F46E5", borderRadius: 6, yAxisID: "y", order: 1 },
        { type: "bar", label: "Calls", data: tr.map((x) => x.calls), backgroundColor: fillRgba("#4F46E5", 0.25), borderRadius: 6, yAxisID: "y", order: 2 },
      ],
    };
  }, [data]);
  const trendOpts = useMemo(
    () => ({
      plugins: { legend: { position: "top", align: "end" } },
      datasets: { bar: { grouped: false, maxBarThickness: 34 } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16 } },
        y: { beginAtZero: true, grid: { color: PALETTE.grid }, title: { display: true, text: "calls" } },
        y1: { beginAtZero: true, position: "right", grid: { display: false }, title: { display: true, text: "talk min" } },
      },
    }),
    []
  );
  const outcomes = (data?.outcomes || []).map((o) => ({ key: o.key, label: (OUTCOME[o.key] || [o.key])[0], color: (OUTCOME[o.key] || [0, "#64748B"])[1], n: o.n }));
  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }));
  const Th = ({ k, children }) => (
    <th className="s3-th" onClick={() => sortBy(k)}>{children}{sort.key === k ? (sort.dir < 0 ? " ↓" : " ↑") : ""}</th>
  );

  const exportUsers = () => {
    const cols = [
      ["name", "User"], ["role", "Role"], ["team", "Team"], ["worked", "Days worked"], ["present", "Present days"], ["auto", "Auto-started days"], ["absent", "Absent days"], ["leave", "Leave days"], ["late", "Late days"],
      ["activeH", "Active (h)"], ["dialerH", "Dialer on (h)"], ["breakH", "Break (h)"], ["calls", "Calls"], ["connected", "Connected"], ["connectRate", "Connect %"], ["missed", "Missed"],
      ["unique", "Unique numbers"], ["talkMin", "Talk (min)"], ["avgTalkSec", "Avg talk (s)"], ["talkPct", "On phone %"], ["callsPerHour", "Calls / hour"], ["responses", "Responses"], ["demoBooked", "Demos booked"], ["interestedAll", "Interested + prospects"], ["enrolled", "Enrolled"], ["collected", "Received (₹)"],
    ].map(([key, label]) => ({ key, label }));
    const out = rows.map((r) => ({ ...r, activeH: (r.activeMin / 60).toFixed(2), dialerH: r.dialerDays ? (r.dialerMin / 60).toFixed(2) : "", breakH: (r.breakMin / 60).toFixed(2), talkMin: Math.round(r.talkSec / 60) }));
    downloadCsv(`sales-360-leaderboard-${range[0].format("YYYYMMDD")}-${range[1].format("YYYYMMDD")}.csv`, rowsToCsv(out, cols));
  };

  // KPI cards — on one user, the comparable ones show the team average too.
  const cmp = one ? data?.compare : null;
  const vs = (mine, team, fmt, label = "team") => (cmp ? { sub: `${label} ${fmt(team)}`, tone: mine === team ? null : mine > team ? "up" : "down" } : {});
  const kpis = [
    { icon: <PhoneOutlined />, id: "calls", label: "Total calls", value: n(t.calls), color: "#2563EB", ...(cmp ? vs(t.calls, cmp.avg.callsPerUser, n, "team avg") : {}), sub: `${n(t.unique)} numbers${cmp ? ` · team avg ${n(cmp.avg.callsPerUser)}` : ` · ${n(t.outbound)} out · ${n(t.inbound)} in`}` },
    { icon: <CheckCircleOutlined />, label: "Connected", value: n(t.connected), color: "#15803D", ...(cmp ? { ...vs(t.connectRate, cmp.avg.connectRate, (v) => `${v}%`), sub: `${t.connectRate}% · team ${cmp.avg.connectRate}%` } : { sub: `${t.connectRate ?? 0}% connect rate` }) },
    { icon: <FieldTimeOutlined />, id: "talk", label: "Total talk time", value: dur(t.talkSec), sub: cmp ? `${cmp.talkShare}% of team talk` : `longest ${dur(t.longestSec)}`, color: "#7C3AED" },
    { icon: <ClockCircleOutlined />, id: "avgtalk", label: "Avg talk / call", value: dur(t.avgTalkSec), color: "#0E7490", ...(cmp ? vs(t.avgTalkSec, cmp.avg.avgTalkSec, dur) : { sub: `${n(t.shortCalls)} under 30s` }) },
    { icon: <CloseCircleOutlined />, id: "missed", label: "Missed by user", value: n(t.missed), sub: "rang, not picked", color: "#B91C1C" },
    { icon: <ThunderboltOutlined />, id: "active", label: "Active time", value: hm(t.activeMin), sub: `${n(t.worked)} day${t.worked === 1 ? "" : "s"} worked · login ${hm(t.loginMin)}`, color: "#15803D" },
    { icon: <DashboardOutlined />, id: "dialer", label: "Dialer on", value: t.dialerDays ? hm(t.dialerMin) : "—", sub: !t.dialerDays ? "no dialer log for these days" : `off ${hm(t.offMin)} while working${t.dialerDays < t.worked ? ` · logged ${t.dialerDays} of ${t.worked} days` : ""}`, tone: t.offMin > (t.dialerMin + t.offMin) * 0.25 ? "down" : null, color: "#2563EB" },
    { icon: <CoffeeOutlined />, id: "break", label: "Break time", value: hm(t.breakMin), sub: "tea + lunch", color: "#B45309" },
    { icon: <PieChartOutlined />, id: "onphone", label: "On phone", value: `${t.talkPct ?? 0}%`, color: "#0369A1", ...(cmp ? vs(t.talkPct, cmp.avg.talkPct, (v) => `${v}%`) : { sub: `idle ${hm(t.idleMin)}` }) },
    { icon: <PhoneOutlined />, id: "cph", label: "Calls / hour", value: t.callsPerHour ?? 0, color: "#4338CA", ...(cmp ? vs(t.callsPerHour, cmp.avg.callsPerHour, (v) => v) : { sub: "of active time" }) },
    { icon: <FormOutlined />, id: "responses", label: "Lead responses", value: n(t.responses), sub: `${n(t.leadsResponded)} leads`, color: "#C2410C" },
    { icon: <AudioOutlined />, id: "recordings", label: "Recordings", value: n(t.recorded), sub: `${dur(t.recordedSec)}${t.recordedMissed ? ` · ${n(t.recordedMissed)} on missed calls` : " recorded"}`, color: "#0F766E" },
  ];

  // What the calls turned into — Lead stage changes + payments in the range.
  const sl = t.sales || {};
  const py = t.pay || {};
  const sAvg = cmp?.salesAvg;
  const vsS = (mine, key) => (sAvg ? { sub: `team avg ${sAvg[key]}`, tone: mine === sAvg[key] ? null : mine > sAvg[key] ? "up" : "down" } : {});
  const topNo = (sl.notInterestedWhy || [])[0];
  const salesKpis = [
    { icon: <ScheduleOutlined />, id: "demos", label: "Demos booked", value: n(sl.demoBooked), color: "#6366F1", ...vsS(sl.demoBooked || 0, "demoBooked"), ...(sAvg ? {} : { sub: `${n(sl.demoAttended)} attended · ${n(sl.demoMissed)} missed` }) },
    { icon: <StarOutlined />, id: "interested", label: "Interested", value: n(sl.interested), color: "#F97316", sub: `+ ${n(sl.prospects)} prospects · ${n(sl.future)} future` },
    { icon: <TrophyOutlined />, id: "enrolled", label: "Enrolled", value: n(sl.enrolled), color: "#16A34A", ...vsS(sl.enrolled || 0, "enrolled"), ...(sAvg ? {} : { sub: (sl.enrolledPlans || [])[0] ? (sl.enrolledPlans[0].key.split(" - ")[0]) : "registrations done" }) },
    { icon: <WalletOutlined />, id: "paid", label: "Payment received", value: inr(py.collected), color: "#0F766E", sub: `${n(py.paid)} payment${py.paid === 1 ? "" : "s"} · ${n(py.newEnrolments)} new plan${py.newEnrolments === 1 ? "" : "s"}` },
    { icon: <HourglassOutlined />, id: "pending", label: "Pending payment", value: inr(py.pendingAmount), color: "#B45309", sub: `${n(py.pending)} unpaid link${py.pending === 1 ? "" : "s"} · ${n(py.links)} sent` },
    { icon: <DislikeOutlined />, id: "notInterested", label: "Not interested", value: n(sl.notInterested), color: "#B91C1C", sub: topNo ? `top: ${topNo.key} (${n(topNo.n)})` : `${n(sl.noResponse)} no response` },
  ];
  // Funnel: every step as a share of connected calls (stages can be skipped,
  // so step-to-step % would jump above 100).
  const funnel = [
    ["Calls made", t.calls, "#2563EB"],
    ["Connected calls", t.connected, "#0E7490"],
    ["1st discussion done", sl.connected, "#06B6D4"],
    ["Demo booked", sl.demoBooked, "#6366F1"],
    ["Demo attended", sl.demoAttended, "#4F46E5"],
    ["Interested + prospects", (sl.interested || 0) + (sl.prospects || 0), "#F97316"],
    ["Enrolled", sl.enrolled, "#16A34A"],
    ["Paid (new plans)", py.newEnrolments, "#0F766E"],
  ].map(([label, v, color]) => ({ label, n: v || 0, color }));

  // The main call numbers against the same-length previous window.
  const pv = t.prev || {};
  const delta = (cur, prev, { pp, downGood } = {}) => {
    if (!prev) return { text: "no calls last period", good: null };
    const d = pp ? Math.round((cur - prev) * 10) / 10 : Math.round(((cur - prev) / prev) * 1000) / 10;
    if (!d) return { text: "• same as last period", good: null };
    return { text: `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}${pp ? " pp" : "%"} vs last period`, good: downGood ? d < 0 : d > 0 };
  };
  const DELTAS = {
    calls: delta(t.calls || 0, pv.calls),
    connected: pv.calls ? delta(t.connectRate || 0, pv.connectRate, { pp: true }) : delta(0, 0),
    talk: delta(t.talkSec || 0, pv.talkSec),
    avgtalk: delta(t.avgTalkSec || 0, pv.avgTalkSec),
    missed: pv.calls ? delta(t.missed || 0, pv.missed || 0.0001, { downGood: true }) : delta(0, 0),
  };
  for (const k of kpis) if (DELTAS[k.id]) k.delta = DELTAS[k.id];

  const allCards = [...kpis, ...salesKpis];
  const card = allCards.find((k) => k.id === focus);
  const DETAIL = {
    calls: { kind: "calls", title: "Every call", initial: {} },
    connected: { kind: "calls", title: "Connected calls", initial: { outcome: "connected" } },
    talk: { kind: "calls", title: "Connected calls · talk time", initial: { outcome: "connected" } },
    avgtalk: { kind: "calls", title: "Connected calls · talk per call", initial: { outcome: "connected" } },
    missed: { kind: "calls", title: "Missed by user — rang, not picked", initial: { outcome: "missed" } },
    recordings: { kind: "calls", title: "Calls with a recording", initial: { recorded: true } },
    active: { kind: "time", title: one ? "Active time · day by day" : "Active time · by user", sortKey: "activeMin" },
    dialer: { kind: "time", title: one ? "Dialer on / off · day by day" : "Dialer on / off · by user", sortKey: "dialerMin", note: "Dialer off = working (not on a break) but out of the calling pool." },
    break: { kind: "time", title: one ? "Breaks · day by day" : "Breaks · by user", sortKey: "breakMin" },
    onphone: { kind: "time", title: one ? "On phone · day by day" : "On phone · by user", sortKey: "talkPct" },
    cph: { kind: "time", title: one ? "Calls per hour · day by day" : "Calls per hour · by user", sortKey: "callsPerHour" },
    responses: { kind: "leads", title: "Lead responses · every stage change", stages: [] },
    demos: { kind: "leads", title: "Demos", stages: ["Demo Booking"] },
    interested: { kind: "leads", title: "Interested, prospects & future", stages: ["Interested Leads", "Prospects", "Future Prospect"] },
    enrolled: { kind: "leads", title: "Enrolled", stages: ["Enrolled"] },
    notInterested: { kind: "leads", title: "Not interested · with reasons", stages: ["Not Interested Leads"] },
    paid: { kind: "pay", title: "Payments received", status: "paid" },
    pending: { kind: "pay", title: "Unpaid payment links", status: "created" },
  };
  const detail = card && DETAIL[focus] ? { ...DETAIL[focus], icon: card.icon, color: card.color } : null;

  const outcomesPanel = (
    <Panel title="Call outcomes" icon={<CheckCircleOutlined />}>
      <Bars items={outcomes} total={t.calls} empty="No calls" />
      <div className="s3-split">
        <div><span>Outgoing</span><b>{n(t.outbound)}</b></div>
        <div><span>Incoming</span><b>{n(t.inbound)}</b></div>
      </div>
    </Panel>
  );
  const heatPanel = (
    <Panel title="When calls happen · weekday × hour" icon={<CalendarOutlined />} className="s3-span2" extra={<span className="s3-muted">darker = more calls</span>}>
      {data && <Heatmap heat={data.heat} />}
    </Panel>
  );
  const talkPanel = (
    <Panel title="Talk length · connected calls" icon={<FieldTimeOutlined />}>
      <Bars items={data?.talkBands || []} color="#7C3AED" total={t.connected} labelWidth={64} empty="No connected calls" />
    </Panel>
  );

  return (
    <div className="s3">
      {/* filters */}
      <div className="s3-filter">
        <div className="s3-filter-top">
          {one && manager && (
            <button type="button" className="s3-back" onClick={() => setUserId("")}><ArrowLeftOutlined /> All users</button>
          )}
          <div className="s3-presets">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" className={preset === p.key ? "on" : ""} onClick={() => pick(p)}>{p.label}</button>
            ))}
            <button type="button" className={preset === "custom" ? "on" : ""} onClick={() => setPreset("custom")}><CalendarOutlined /> Custom</button>
          </div>
        </div>
        <div className="s3-filter-row">
          <DatePicker.RangePicker
            showTime={{ format: "h:mm A", minuteStep: 1 }}
            format="D MMM YYYY, h:mm A"
            value={range}
            allowClear={false}
            disabledDate={(d) => d.isAfter(dayjs(), "day")}
            onChange={(v) => {
              if (v && v[0] && v[1]) {
                setRange(v);
                setPreset("custom");
              }
            }}
            className="s3-range"
          />
          {manager && (
            <select className="hub-select" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="User">
              <option value="">All Sales users</option>
              {(data?.people || []).map((u) => <option key={u.adminId} value={u.adminId}>{u.name} · {u.role}</option>)}
            </select>
          )}
          {manager && !userId && (
            <select className="hub-select" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
              <option value="">All teams</option>
              {(data?.teams || []).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          <button type="button" className="hub-btn s3-sq" onClick={refresh} aria-label="Refresh"><ReloadOutlined spin={loading} /></button>
          <button type="button" className="s3-export" onClick={exportXlsx} disabled={exporting}>
            <FileExcelOutlined /> {exporting ? "Preparing…" : "Export Excel"}
          </button>
        </div>
        <div className="s3-range-text"><ClockCircleOutlined /> {rangeText}{days ? ` · ${days} day${days === 1 ? "" : "s"}` : ""} · minute-level</div>
      </div>

      {data && !data.rows.length && <div className="s3-panel"><div className="s3-empty">No Sales user to show here.</div></div>}

      {/* hero */}
      {one ? (
        <section className="s3-hero">
          <span className="s3-avatar big">{initials(one.name)}</span>
          <div className="s3-hero-txt">
            <h2>{one.name}</h2>
            <p>
              {one.role}{one.team ? ` · ${one.team}` : ""} · {PRESETS.find((p) => p.key === preset)?.label || "Custom range"}
              {data.now && (
                <> · now: <b style={{ color: (NOW_STATUS[data.now.status] || [0, "#fff"])[1] }}>{(NOW_STATUS[data.now.status] || [data.now.status])[0]}{data.now.dialerOn ? `, dialer ${data.now.dialerStatus === "OnCall" ? "on a call" : "on"}` : ", dialer off"}</b></>
              )}
            </p>
            <div className="s3-hero-tags">
              {oneDay ? (
                <>
                  <span>{oneDay.loginAt ? `Login ${clock(oneDay.loginAt)}${oneDay.derived ? " (from dialer)" : ""}` : oneDay.autoStartedAt ? `Auto-started ${clock(oneDay.autoStartedAt)} · no login` : (DAY_STATUS[oneDay.status] || [oneDay.status])[0]}</span>
                  {oneDay.lateMin > 15 && <span>late {hm(oneDay.lateMin)}</span>}
                  <span>{oneDay.logoutAt ? `Logout ${clock(oneDay.logoutAt)}` : oneDay.startAt ? "not logged out" : "—"}</span>
                  {oneDay.dialerMin != null && <span>dialer on {hm(oneDay.dialerMin)}{oneDay.offMin ? ` · off ${hm(oneDay.offMin)}` : ""}</span>}
                  <span>break {hm(one.breakMin)}</span>
                  {one.lastCall && <span>last call {clock(one.lastCall)}</span>}
                </>
              ) : (
                <>
                  <span>{n(one.worked)} days worked</span>
                  <span>{one.present} present</span>
                  <span>{one.auto} auto-started</span>
                  <span>{one.absent} absent</span>
                  <span>{one.leave} leave</span>
                  <span>{one.late} late</span>
                  <span>avg start {minClock(one.avgLoginClock)}</span>
                </>
              )}
            </div>
          </div>
          {cmp && (
            <div className="s3-hero-scores">
              {[
                [cmp.rank.calls ? `#${cmp.rank.calls}` : "—", "calls", `of ${cmp.active} calling`],
                [`${one.connectRate}%`, "connect rate", cmp.rank.connectRate ? `#${cmp.rank.connectRate} of ${cmp.active}` : "—"],
                [dur(one.talkSec), "talk time", cmp.rank.talkSec ? `#${cmp.rank.talkSec} of ${cmp.active}` : "—"],
                [n(one.sales?.demoBooked), "demos", cmp.rank.demoBooked ? `#${cmp.rank.demoBooked} of ${cmp.active}` : "—"],
                [n(one.sales?.enrolled), "enrolled", cmp.rank.enrolled ? `#${cmp.rank.enrolled} of ${cmp.active}` : "—"],
              ].map(([v, k, r]) => (
                <div key={k} className="s3-hero-score"><b>{v}</b><span>{k}</span><small>{r}</small></div>
              ))}
            </div>
          )}
        </section>
      ) : (
        data && data.rows.length > 0 && (
          <section className="s3-hero">
            <span className="s3-avatar big"><TeamOutlined /></span>
            <div className="s3-hero-txt">
              <h2>{team || "All Sales users"}</h2>
              <p>{n(t.staff)} people · {n(t.activeUsers)} made calls in this range · {days} day{days === 1 ? "" : "s"}</p>
              <div className="s3-hero-tags">
                <span>{n(t.present)} present days</span>
                <span>{n(t.auto)} auto-started</span>
                <span>{n(t.absent)} absent</span>
                <span>{t.leave || 0} leave</span>
                <span>{n(t.late)} late</span>
                <span>avg start {minClock(t.avgLoginClock)}</span>
              </div>
            </div>
            <div className="s3-hero-scores">
              <div className="s3-hero-score"><b>{t.connectRate ?? 0}%</b><span>connect rate</span></div>
              <div className="s3-hero-score"><b>{dur(t.talkSec)}</b><span>total talk</span></div>
            </div>
          </section>
        )
      )}

      {/* KPI cards */}
      <div className="s3-section"><CalendarOutlined /> Attendance <span>month calendar — {effectiveUser ? "this user" : "everyone"} · hover a day for who and when</span></div>
      <AttendanceCalendar adminId={effectiveUser} team={team} monthHint={range[1].format("YYYY-MM")} />

      <div className="s3-section"><PhoneOutlined /> Calls &amp; time</div>
      <div className={`s3-kpis ${loading ? "is-loading" : ""}`}>
        {kpis.map((k, i) => <Kpi key={k.id} i={i} {...k} active={focus === k.id} onOpen={() => setFocus(focus === k.id ? null : k.id)} />)}
      </div>
      <div className="s3-section"><TrophyOutlined /> Sales results <span>demos, interest, enrolments and money — from lead stages and payment links</span></div>
      <div className={`s3-kpis ${loading ? "is-loading" : ""}`}>
        {salesKpis.map((k, i) => <Kpi key={k.id} i={i} {...k} active={focus === k.id} onOpen={() => setFocus(focus === k.id ? null : k.id)} />)}
      </div>

      {/* the clicked card, in full */}
      {focus && detail && (
        <section ref={detailRef} className="s3-panel s3-detail" style={{ "--c": detail.color }}>
          <header>
            <h4><span className="s3-detail-ico">{detail.icon}</span> {detail.title}</h4>
            <span className="s3-muted">{rangeText}</span>
            <button type="button" className="s3-detail-close" onClick={() => setFocus(null)} aria-label="Close detail"><CloseOutlined /></button>
          </header>
          {detail.note && <p className="s3-note" style={{ marginTop: 0 }}>{detail.note}</p>}
          {detail.kind === "calls" && <CallLog key={focus} base={base} cards={!!one} title={detail.title} initial={detail.initial} />}
          {detail.kind === "leads" && <LeadLog key={focus} base={base} stages={detail.stages} showUser={!one} />}
          {detail.kind === "time" && (one ? (
            <div className="hub-table-wrapper">
              <table className="hub-table s3-table">
                <thead>
                  <tr><th>Date</th><th>Status</th><th>Start</th><th>Logout</th><th>Active</th><th>Dialer on</th><th>Dialer off</th><th>Break</th><th>Calls</th><th>Talk</th><th>On phone</th><th>Calls / h</th></tr>
                </thead>
                <tbody>
                  {(data?.days || []).filter((d) => d.startAt || d.calls).map((d) => {
                    const st = DAY_STATUS[d.status] || [d.status, "#64748B"];
                    return (
                      <tr key={d.dayKey} className="s3-click" onClick={() => setDayOpen({ day: d, user: one })}>
                        <td style={{ whiteSpace: "nowrap" }}><b>{dayjs(d.dayKey).format("D MMM")}</b> <span className="s3-muted">{dayjs(d.dayKey).format("ddd")}</span></td>
                        <td><Pill color={st[1]}>{st[0]}</Pill></td>
                        <td>{clock(d.startAt)}</td>
                        <td>{d.logoutAt ? clock(d.logoutAt) : <span className="s3-muted">—</span>}</td>
                        <td>{hm(d.activeMin)}</td>
                        <td>{d.dialerMin == null ? <span className="s3-muted">no log</span> : hm(d.dialerMin)}</td>
                        <td>{d.offMin ? <span className={d.offMin > d.activeMin * 0.25 ? "s3-warn" : ""}>{hm(d.offMin)}</span> : "—"}</td>
                        <td>{hm(d.breakMin)}</td>
                        <td><b>{n(d.calls)}</b></td>
                        <td>{dur(d.talkSec)}</td>
                        <td>{d.activeMin ? `${Math.round((d.talkSec / 60 / d.activeMin) * 1000) / 10}%` : "—"}</td>
                        <td>{d.activeMin ? Math.round((d.calls / (d.activeMin / 60)) * 10) / 10 : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="hub-table-wrapper">
              <table className="hub-table s3-table">
                <thead>
                  <tr><th>User</th><th>Days</th><th>Active</th><th>Dialer on</th><th>Dialer off</th><th>Break</th><th>Calls</th><th>Talk</th><th>On phone</th><th>Calls / h</th><th>Avg start</th></tr>
                </thead>
                <tbody>
                  {[...(data?.rows || [])].sort((a, b) => (b[detail.sortKey] || 0) - (a[detail.sortKey] || 0)).map((r) => (
                    <tr key={r.adminId} className="s3-click" onClick={() => { setFocus(null); setUserId(r.adminId); }}>
                      <td><b>{r.name}</b><div className="s3-muted">{r.role}</div></td>
                      <td>{r.worked}<span className="s3-muted"> / {r.workingDays}</span></td>
                      <td className={detail.sortKey === "activeMin" ? "s3-hot" : ""}>{hm(r.activeMin)}</td>
                      <td className={detail.sortKey === "dialerMin" ? "s3-hot" : ""}>{r.dialerDays ? hm(r.dialerMin) : <span className="s3-muted">no log</span>}</td>
                      <td>{r.offMin ? hm(r.offMin) : "—"}</td>
                      <td className={detail.sortKey === "breakMin" ? "s3-hot" : ""}>{hm(r.breakMin)}</td>
                      <td>{n(r.calls)}</td>
                      <td>{dur(r.talkSec)}</td>
                      <td className={detail.sortKey === "talkPct" ? "s3-hot" : ""}>{r.talkPct}%</td>
                      <td className={detail.sortKey === "callsPerHour" ? "s3-hot" : ""}>{r.callsPerHour}</td>
                      <td>{minClock(r.avgLoginClock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {detail.kind === "pay" && (() => {
            const list = (data?.payments || []).filter((p) => p.status === detail.status);
            return !list.length ? (
              <div className="s3-empty">{detail.status === "paid" ? "No payment received in this range." : "No unpaid payment link in this range."}</div>
            ) : (
              <div className="hub-table-wrapper">
                <table className="hub-table s3-table">
                  <thead>
                    <tr><th>Created</th><th>Student</th><th>Course</th><th>Instalment</th><th>Amount</th><th>{detail.status === "paid" ? "Paid at" : "Due"}</th><th>Sent by</th></tr>
                  </thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p._id}>
                        <td style={{ whiteSpace: "nowrap" }}>{when(p.created)}</td>
                        <td><b>{p.name}</b><div className="s3-muted">{p.phone || p.email}</div></td>
                        <td>{p.course || "—"}</td>
                        <td>{p.installment || "one-time"}{p.planTotal ? <div className="s3-muted">plan {inr(p.planTotal)}</div> : null}</td>
                        <td><b>{inr(p.amount)}</b></td>
                        <td style={{ whiteSpace: "nowrap" }}>{detail.status === "paid" ? when(p.paidAt) : p.dueAt ? when(p.dueAt) : "—"}</td>
                        <td>{p.by || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </section>
      )}

      {one && <TodayGlance user={one} tick={tick} onOpen={(day) => setDayOpen({ day, user: one })} />}

      {/* charts */}
      <div className="s3-grid">
        <Panel title={`Calls & talk time · by ${data?.range?.bucket || "day"}`} icon={<PhoneOutlined />} className="s3-span2">
          {data && <ChartCanvas type="bar" data={trendData} options={trendOpts} height={260} />}
        </Panel>
        {outcomesPanel}
        {heatPanel}
        {talkPanel}
      </div>

      {/* sales results */}
      <div className="s3-grid">
        <Panel title="Sales funnel · calls to money" icon={<FunnelPlotOutlined />} className="s3-span2" extra={<span className="s3-muted">% of connected calls</span>}>
          <div className="s3-funnel">
            {funnel.map((x, i) => {
              const max = Math.max(1, funnel[0].n);
              return (
                <div key={x.label} className="s3-funnel-row" style={{ "--c": x.color, animationDelay: `${i * 50}ms` }}>
                  <span className="s3-funnel-l">{x.label}</span>
                  <span className="s3-funnel-t"><i style={{ width: `${Math.max(x.n ? 2 : 0, (x.n / max) * 100)}%` }} /></span>
                  <b>{n(x.n)}</b>
                  <em>{i >= 2 && t.connected ? `${Math.round((x.n / t.connected) * 1000) / 10}%` : ""}</em>
                </div>
              );
            })}
          </div>
          <p className="s3-note">Steps come from the lead stage each lead was moved to in this range (unique leads). A lead can jump stages — e.g. straight from a call to Demo booked — so a later step can be bigger than an earlier one.</p>
        </Panel>
        <Panel title="Money" icon={<WalletOutlined />}>
          <div className="s3-money">
            <div className="big"><span>New plans sold</span><b>{n(py.newEnrolments)}</b><small>deal value {inr(py.dealValue)} (plan totals incl. EMI)</small></div>
            <div><span>Links sent</span><b>{n(py.links)}</b><small>by {one ? one.name.split(" ")[0] : "the team"}</small></div>
            <div><span>Expired / failed</span><b>{n(py.expired)}</b><small>links that never got paid</small></div>
            {cmp && <div><span>Team avg received</span><b>{inr(cmp.payAvg?.collected)}</b><small>per calling user</small></div>}
          </div>
          {data?.target && (
            <div className="s3-target">
              <b>Target {dayjs(`${data.target.period}-01`).format("MMM YYYY")}</b>
              {data.target.targetRevenue ? <span>Revenue {inr(py.collected)} / {inr(data.target.targetRevenue)}</span> : null}
              {data.target.targetDeals ? <span>Deals {n(py.newEnrolments)} / {n(data.target.targetDeals)}</span> : null}
              {data.target.targetCalls ? <span>Calls {n(t.calls)} / {n(data.target.targetCalls)}</span> : null}
            </div>
          )}
          <p className="s3-note">Money received and pending are on the cards above — click them for every payment. EMI instalments count for whoever sold the plan.</p>
        </Panel>
      </div>

      <LeadsSection base={base} who={one ? one.name : team ? `Team ${team}` : "Every Sales user"} />

      {/* one user: their pipeline + what is due */}
      {one && data?.pipeline && (
        <div className="s3-grid">
          <Panel title={`Pipeline right now · ${n(data.pipeline.leads)} leads`} icon={<AimOutlined />} extra={<span className="s3-muted">last moved by {one.name.split(" ")[0]}</span>}>
            <Bars items={data.pipeline.byStage.map((x) => ({ ...x, color: STAGE_COLOR[x.key] }))} labelWidth={140} empty="No leads" />
          </Panel>
          <Panel title="Due & coming up" icon={<BellOutlined />} className="s3-span2">
            <div className="s3-due">
              {[
                ["Demos", data.pipeline.demos, "#6366F1", "No demo booked"],
                ["Callbacks", data.pipeline.callbacks, "#EC4899", "No callback set"],
                ["Future follow-ups", data.pipeline.future, "#14B8A6", "None"],
              ].map(([title, g, color, empty]) => (
                <div key={title} className="s3-due-col" style={{ "--c": color }}>
                  <header>
                    <b>{title}</b>
                    <span>{g.overdueCount ? <em className="bad">{g.overdueCount} overdue</em> : null}<em>{g.upcomingCount} upcoming</em></span>
                  </header>
                  {!g.overdue.length && !g.upcoming.length && <div className="s3-empty">{empty}</div>}
                  {[...g.overdue.slice(0, 5).map((x) => ({ ...x, late: true })), ...g.upcoming.slice(0, 8)].map((x) => (
                    <div key={`${x._id}-${x.at}`} className={`s3-due-item ${x.late ? "late" : ""}`}>
                      <time>{when(x.at)}</time>
                      <span>{x.name || x.phone}</span>
                      <small>{x.phone}{x.late ? " · overdue" : ""}</small>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {/* leaderboard (team) */}
      {!one && rows.length > 0 && (
        <Panel title="Leaderboard · click a person for their 360°" icon={<TeamOutlined />} extra={<button type="button" className="hub-btn" onClick={exportUsers}><DownloadOutlined /> CSV</button>}>
          <div className="hub-table-wrapper">
            <table className="hub-table s3-table">
              <thead>
                <tr>
                  <th>#</th>
                  <Th k="name">User</Th>
                  <Th k="worked">Days</Th>
                  <Th k="activeMin">Active</Th>
                  <Th k="dialerMin">Dialer on</Th>
                  <Th k="breakMin">Break</Th>
                  <Th k="calls">Calls</Th>
                  <Th k="connected">Connected</Th>
                  <Th k="talkSec">Talk</Th>
                  <Th k="avgTalkSec">Avg</Th>
                  <Th k="talkPct">On phone</Th>
                  <Th k="missed">Missed</Th>
                  <Th k="responses">Responses</Th>
                  <Th k="demoBooked">Demos</Th>
                  <Th k="interestedAll">Interested</Th>
                  <Th k="enrolled">Enrolled</Th>
                  <Th k="collected">Received</Th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const maxCalls = Math.max(1, ...rows.map((x) => x.calls));
                  return rows.map((r, i) => (
                    <tr key={r.adminId} className="s3-click" onClick={() => setUserId(r.adminId)}>
                      <td>{sort.dir < 0 && i < 3 && r[sort.key] ? <span className={`s3-rank r${i + 1}`}>{i + 1}</span> : <span className="s3-rank-n">{i + 1}</span>}</td>
                      <td>
                        <div className="s3-who">
                          <span className="s3-avatar">{initials(r.name)}</span>
                          <div><b>{r.name}</b><div className="s3-muted">{r.role}{r.team ? ` · ${r.team}` : ""}</div></div>
                        </div>
                      </td>
                      <td>{r.worked}<span className="s3-muted"> / {r.workingDays}</span>{r.auto ? <div className="s3-muted">{r.auto} auto-started</div> : null}{r.late ? <div className="s3-warn">{r.late} late</div> : null}</td>
                      <td>{hm(r.activeMin)}</td>
                      <td>{r.dialerDays ? hm(r.dialerMin) : <span className="s3-muted">no log</span>}</td>
                      <td>{hm(r.breakMin)}</td>
                      <td style={{ minWidth: 120 }}><b>{n(r.calls)}</b><span className="s3-mini"><i style={{ width: `${(r.calls / maxCalls) * 100}%` }} /></span></td>
                      <td>{n(r.connected)} <span className="s3-muted">{r.connectRate}%</span></td>
                      <td><b>{dur(r.talkSec)}</b></td>
                      <td>{dur(r.avgTalkSec)}</td>
                      <td>{r.talkPct}%</td>
                      <td>{r.missed ? <span className="s3-warn">{r.missed}</span> : 0}</td>
                      <td>{n(r.responses)}</td>
                      <td>{r.demoBooked ? <b>{n(r.demoBooked)}</b> : 0}</td>
                      <td>{n(r.interestedAll)}</td>
                      <td>{r.enrolled ? <b className="t-up">{n(r.enrolled)}</b> : 0}</td>
                      <td>{r.collected ? <b>{inr(r.collected)}</b> : "—"}</td>
                      <td><span className="s3-go">Open 360° →</span></td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* day by day (one user) */}
      {one && (
        <Panel
          title="Day by day · click a day for minute-by-minute"
          icon={<CalendarOutlined />}
          extra={
            <button type="button" className="hub-btn" onClick={() => downloadFile(`workday/admin/report?month=${range[1].format("YYYY-MM")}&adminId=${one.adminId}`, "attendance.xlsx")}>
              <FileExcelOutlined /> Month report (Excel)
            </button>
          }
        >
          <div className="hub-table-wrapper">
            <table className="hub-table s3-table">
              <thead>
                <tr><th>Date</th><th>Status</th><th>Login</th><th>Logout</th><th>Active</th><th>Dialer on</th><th>Break</th><th>Calls</th><th>Connected</th><th>Talk</th><th>Missed</th><th /></tr>
              </thead>
              <tbody>
                {data.days.map((d) => {
                  const st = DAY_STATUS[d.status] || [d.status, "#64748B"];
                  return (
                    <tr key={d.dayKey} className="s3-click" onClick={() => setDayOpen({ day: d, user: one })}>
                      <td style={{ whiteSpace: "nowrap" }}><b>{dayjs(d.dayKey).format("D MMM")}</b> <span className="s3-muted">{dayjs(d.dayKey).format("ddd")}</span></td>
                      <td>
                        <Pill color={st[1]}>{st[0]}</Pill>
                        {d.derived && <div className="s3-muted">from dialer</div>}
                        {d.holiday && <div className="s3-muted">{d.holiday}</div>}
                        {d.leave && d.status !== "leave" && <div className="s3-muted">Leave: {d.leave}</div>}
                      </td>
                      <td>{d.loginAt ? clock(d.loginAt) : d.autoStartedAt ? <span style={{ color: "#2563EB" }}>auto {clock(d.autoStartedAt)}</span> : "—"}{d.lateMin > 15 && <div className="s3-warn">late {hm(d.lateMin)}</div>}</td>
                      <td>{d.logoutAt ? clock(d.logoutAt) : d.loginAt || d.autoStartedAt ? <span className="s3-muted">no logout</span> : "—"}</td>
                      <td>{d.activeMin ? hm(d.activeMin) : "—"}</td>
                      <td>{d.dialerMin == null ? <span className="s3-muted">{d.activeMin ? "no log" : "—"}</span> : <>{hm(d.dialerMin)}{d.offMin > 0 && <div className="s3-muted">off {hm(d.offMin)}</div>}</>}</td>
                      <td>{d.breakMin ? hm(d.breakMin) : "—"}</td>
                      <td><b>{d.calls || "—"}</b></td>
                      <td>{d.connected || "—"}</td>
                      <td>{d.talkSec ? <b>{dur(d.talkSec)}</b> : "—"}</td>
                      <td>{d.missed ? <span className="s3-warn">{d.missed}</span> : "—"}</td>
                      <td><span className="s3-go">Timeline →</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {data && data.rows.length > 0 && (
        <CallLog base={base} cards={!!one} title={one ? `${one.name.split(" ")[0]}'s calls & recordings` : "All calls & recordings"} />
      )}
      <DayModal target={dayOpen} onClose={() => setDayOpen(null)} />
    </div>
  );
}
