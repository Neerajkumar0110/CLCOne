import React, { useEffect, useState } from "react";
import { request } from "@/request";
import HubModal from "@/components/HubModal";
import {
  PlayCircleOutlined,
  LeftOutlined,
  RightOutlined,
  SearchOutlined,
  PhoneOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  SwapOutlined,
  CloseOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import { fmtDuration, fmtDateTime } from "./shared";

// Recording management — KPIs, a per-user breakdown, and the call list,
// all over the same filters (backend callingController/recordings.js).
// Search by contact / lead / user name or by number; click a user row or a
// KPI tile to filter by it.

const BLANK = { q: "", agent: "", direction: "", status: "All", campaign: "", range: "30d", from: "", to: "" };
const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

// IST day start, `days` back (0 = today).
function istDayStart(days) {
  const now = new Date(Date.now() + 5.5 * 3600e3);
  now.setUTCHours(0, 0, 0, 0);
  return new Date(now.getTime() - 5.5 * 3600e3 - days * 864e5);
}
function rangeParams(f) {
  if (f.range === "today") return { from: istDayStart(0).toISOString() };
  if (f.range === "7d") return { from: istDayStart(6).toISOString() };
  if (f.range === "30d") return { from: istDayStart(29).toISOString() };
  if (f.range === "custom") {
    const out = {};
    if (f.from) out.from = new Date(`${f.from}T00:00:00+05:30`).toISOString();
    if (f.to) out.to = new Date(`${f.to}T23:59:59+05:30`).toISOString();
    return out;
  }
  return {};
}
const fmtHours = (sec) => {
  const m = Math.round((sec || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

export default function Recordings() {
  const [campaigns, setCampaigns] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [seesAll, setSeesAll] = useState(false);
  const [users, setUsers] = useState([]); // filter options, from the unfiltered breakdown
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [count, setCount] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [f, setF] = useState(BLANK);
  const [qDraft, setQDraft] = useState("");
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    request.get({ entity: "calling/campaigns?items=100" }).then((r) => r?.success && setCampaigns(r.result));
  }, []);

  const load = async (p = 1, size = pageSize) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), items: String(size) });
    if (f.q) params.set("q", f.q);
    if (f.agent) params.set("agent", f.agent);
    if (f.direction) params.set("direction", f.direction);
    if (f.campaign) params.set("campaign", f.campaign);
    if (f.status !== "All") params.set("status", f.status);
    Object.entries(rangeParams(f)).forEach(([k, v]) => params.set(k, v));
    const r = await request.get({ entity: `calling/recordings?${params}` });
    setRows(r?.success ? r.result : []);
    setSummary(r?.success ? r.summary : null);
    setSeesAll(!!r?.seesAll);
    // Keep every user seen so far, so a narrowing filter doesn't shrink the picker.
    if (r?.success && r.summary?.byUser?.length) {
      setUsers((prev) => {
        const byId = new Map(prev.map((u) => [String(u.id), u]));
        for (const u of r.summary.byUser) if (u.userId) byId.set(String(u.userId), { id: u.userId, name: u.name });
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
    }
    setPages(r?.pagination?.pages || 1);
    setCount(r?.pagination?.count || 0);
    setPage(p);
    setLoading(false);
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const set = (patch) => setF((prev) => ({ ...prev, ...patch }));
  const toggle = (key, value) => setF((prev) => ({ ...prev, [key]: prev[key] === value ? BLANK[key] : value }));
  const filtered = Object.keys(BLANK).some((k) => k !== "range" && k !== "from" && k !== "to" && f[k] !== BLANK[k]);

  const openDetail = async (row) => {
    setDetail({ row, info: null, loading: true });
    const r = await request.get({ entity: `calling/recordings/${row._id}` });
    setDetail({ row, info: r?.success ? r.result : null, loading: false });
  };

  const badge = (s) => (s === "available" ? "hub-badge-green" : s === "processing" ? "hub-badge-yellow" : "hub-badge-gray");
  const s = summary || {};
  const selectedUser = users.find((u) => String(u.id) === String(f.agent));

  return (
    <div className="hub-stack">
      {/* ── header + filters ── */}
      <div className="hub-card">
        <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 10 }}>
          <h3><PlayCircleOutlined /> Call Recordings</h3>
          <div style={{ display: "flex", gap: 4, background: "var(--hub-bg-soft)", borderRadius: 10, padding: 3 }}>
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => set({ range: r.key })}
                style={{
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: f.range === r.key ? "var(--hub-surface)" : "transparent",
                  color: f.range === r.key ? "var(--hub-text)" : "var(--hub-muted)",
                  boxShadow: f.range === r.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          <form
            style={{ gridColumn: "span 2", position: "relative", minWidth: 0 }}
            onSubmit={(e) => {
              e.preventDefault();
              set({ q: qDraft.trim() });
            }}
          >
            <SearchOutlined style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--hub-muted)" }} />
            <input
              className="hub-input"
              style={{ paddingLeft: 34, width: "100%" }}
              placeholder="Search name or number, press Enter"
              value={qDraft}
              onChange={(e) => {
                setQDraft(e.target.value);
                if (!e.target.value && f.q) set({ q: "" });
              }}
            />
          </form>
          {seesAll && (
            <select className="hub-select" value={f.agent} onChange={(e) => set({ agent: e.target.value })}>
              <option value="">All users</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <select className="hub-select" value={f.direction} onChange={(e) => set({ direction: e.target.value })}>
            <option value="">Inbound + Outbound</option>
            <option value="Inbound">Inbound only</option>
            <option value="Outbound">Outbound only</option>
          </select>
          <select className="hub-select" value={f.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="All">Any recording status</option>
            <option value="available">Recorded</option>
            <option value="processing">Processing</option>
            <option value="unavailable">Not recorded</option>
          </select>
          <select className="hub-select" value={f.campaign} onChange={(e) => set({ campaign: e.target.value })}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
          {f.range === "custom" && (
            <>
              <input type="date" className="hub-input" value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label="From date" />
              <input type="date" className="hub-input" value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label="To date" />
            </>
          )}
        </div>

        {filtered && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            {f.q && <Chip label={`“${f.q}”`} onClear={() => { set({ q: "" }); setQDraft(""); }} />}
            {selectedUser && <Chip label={selectedUser.name} onClear={() => set({ agent: "" })} />}
            {f.direction && <Chip label={f.direction} onClear={() => set({ direction: "" })} />}
            {f.status !== "All" && <Chip label={{ available: "Recorded", processing: "Processing", unavailable: "Not recorded" }[f.status]} onClear={() => set({ status: "All" })} />}
            {f.campaign && <Chip label={campaigns.find((c) => c._id === f.campaign)?.name || "Campaign"} onClear={() => set({ campaign: "" })} />}
            <button type="button" className="hub-link-btn" style={{ fontSize: 12 }} onClick={() => { setF({ ...BLANK, range: f.range, from: f.from, to: f.to }); setQDraft(""); }}>
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* ── KPIs ── */}
      {summary && (
        <div className="hub-card">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Kpi icon={<PhoneOutlined />} color="#2563eb" value={s.calls} label="Answered calls" sub={`${s.inbound} in · ${s.outbound} out`} />
            <Kpi
              icon={<CheckCircleOutlined />}
              color="#16a34a"
              value={s.available}
              label="Recorded"
              sub={`${s.coverage}% coverage`}
              active={f.status === "available"}
              onClick={() => toggle("status", "available")}
            />
            <Kpi
              icon={<ExclamationCircleOutlined />}
              color="#dc2626"
              value={s.unavailable}
              label="Not recorded"
              sub={s.calls ? `${Math.round((s.unavailable / s.calls) * 100)}% of calls` : ""}
              active={f.status === "unavailable"}
              onClick={() => toggle("status", "unavailable")}
            />
            <Kpi icon={<FieldTimeOutlined />} color="#7c3aed" value={fmtHours(s.recordedSec)} label="Recorded time" sub={`avg ${fmtDuration(s.avgRecordedSec)} per call`} />
            <Kpi icon={<SwapOutlined />} color="#0891b2" value={s.inbound} label="Inbound" active={f.direction === "Inbound"} onClick={() => toggle("direction", "Inbound")} sub={`${s.notPicked} not picked by anyone`} />
          </div>

          {s.calls > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "var(--hub-border)" }}>
                <div style={{ width: `${(s.available / s.calls) * 100}%`, background: "#16a34a" }} title={`Recorded: ${s.available}`} />
                <div style={{ width: `${(s.processing / s.calls) * 100}%`, background: "#f59e0b" }} title={`Processing: ${s.processing}`} />
                <div style={{ width: `${(s.unavailable / s.calls) * 100}%`, background: "#ef4444" }} title={`Not recorded: ${s.unavailable}`} />
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11.5, color: "var(--hub-muted)", marginTop: 6, fontWeight: 600 }}>
                <span><span style={{ color: "#16a34a" }}>●</span> Recorded {s.available}</span>
                {s.processing > 0 && <span><span style={{ color: "#f59e0b" }}>●</span> Processing {s.processing}</span>}
                <span><span style={{ color: "#ef4444" }}>●</span> Not recorded {s.unavailable}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── per-user breakdown (management) ── */}
      {seesAll && summary && s.byUser.length > 0 && (
        <div className="hub-card">
          <div className="hub-card-header">
            <h3>By user</h3>
            <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>Click a user to see all their recordings</span>
          </div>
          <div className="hub-table-wrapper">
            <table className="hub-table">
              <thead>
                <tr><th>User</th><th>Calls</th><th>Recorded</th><th style={{ minWidth: 160 }}>Coverage</th><th>Recorded time</th><th>Last call</th></tr>
              </thead>
              <tbody>
                {s.byUser.map((u) => {
                  const on = u.userId && String(u.userId) === String(f.agent);
                  return (
                    <tr
                      key={u.userId || "none"}
                      onClick={() => u.userId && toggle("agent", u.userId)}
                      style={{ cursor: u.userId ? "pointer" : "default", background: on ? "var(--hub-blue-soft)" : undefined }}
                      title={u.userId ? (on ? "Click again to show everyone" : `Show only ${u.name}`) : "Calls nobody took and no user could be matched to"}
                    >
                      <td style={{ fontWeight: 600, color: u.userId ? "var(--hub-text)" : "var(--hub-muted)" }}>{u.name}</td>
                      <td>{u.calls}</td>
                      <td>{u.available}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 8, borderRadius: 999, background: "var(--hub-border)", overflow: "hidden" }}>
                            <div style={{ width: `${u.coverage}%`, height: "100%", background: u.coverage >= 90 ? "#16a34a" : u.coverage >= 60 ? "#f59e0b" : "#ef4444" }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, width: 36, textAlign: "right" }}>{u.coverage}%</span>
                        </div>
                      </td>
                      <td>{fmtHours(u.recordedSec)}</td>
                      <td>{fmtDateTime(u.last)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── call list ── */}
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>{selectedUser ? `${selectedUser.name}'s recordings` : "All recordings"}</h3>
          <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>{loading ? "Loading…" : `${count} call${count === 1 ? "" : "s"}`}</span>
        </div>
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead>
              <tr><th>Contact</th><th>Number</th><th>User</th><th>Type</th><th>Campaign</th><th>Date / Time</th><th>Duration</th><th>Recording</th><th></th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9}><div className="hub-empty">Loading…</div></td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={9}><div className="hub-empty">{filtered ? "No calls match these filters." : "No recordings."}</div></td></tr>}
              {!loading &&
                rows.map((r) => (
                  <tr key={r._id}>
                    <td style={{ fontWeight: 600 }}>{r.contactName || <span style={{ color: "var(--hub-muted)", fontWeight: 400 }}>Unknown</span>}</td>
                    <td>{r.phone}</td>
                    <td>
                      {r.agentName || "—"}
                      {/* nobody took it — filed under the lead's owner / last user who spoke to them */}
                      {r.ownerOnly && <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>not picked · their lead</div>}
                    </td>
                    <td>
                      <span className={`hub-badge ${r.direction === "Inbound" ? "hub-badge-blue" : "hub-badge-gray"}`}>{r.direction === "Inbound" ? "In" : "Out"}</span>
                    </td>
                    <td>{r.campaign || "—"}</td>
                    <td>{fmtDateTime(r.at)}</td>
                    <td>{r.durationSec ? fmtDuration(r.durationSec) : "—"}</td>
                    <td><span className={`hub-badge ${badge(r.recordingStatus)}`}>{r.recordingStatus === "available" ? "recorded" : r.recordingStatus === "unavailable" ? "not recorded" : r.recordingStatus}</span></td>
                    <td>
                      <button type="button" className="hub-btn" style={{ padding: "4px 10px" }} onClick={() => openDetail(r)}>
                        {r.recordingStatus === "available" ? <><PlayCircleOutlined /> Play</> : "Open"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {count > 0 && (
          <div className="hub-row" style={{ justifyContent: "space-between", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--hub-muted)" }}>Page {page} of {pages || 1} · {count} total</span>
            <div className="hub-row" style={{ gap: 8 }}>
              <select
                className="hub-select"
                style={{ width: "auto" }}
                value={pageSize}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setPageSize(n);
                  load(1, n);
                }}
                aria-label="Calls per page"
              >
                {[10, 20, 50, 100, 200].map((n) => <option key={n} value={n}>{n} / page</option>)}
              </select>
              <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => load(page - 1)}><LeftOutlined /> Prev</button>
              <button type="button" className="hub-btn" disabled={page >= pages} onClick={() => load(page + 1)}>Next <RightOutlined /></button>
            </div>
          </div>
        )}
      </div>

      {detail && (
        <HubModal
          open
          onClose={() => setDetail(null)}
          title="Recording"
          subtitle={`${detail.row.contactName || "Unknown"} · ${detail.row.phone}`}
          width={480}
          footer={<button type="button" className="hub-btn hub-btn-primary" onClick={() => setDetail(null)}>Close</button>}
        >
          <div className="hub-grid-2" style={{ gap: 12 }}>
            <Field label="User" value={detail.row.agentName ? `${detail.row.agentName}${detail.row.ownerOnly ? " (not picked)" : ""}` : null} />
            <Field label="Type" value={detail.row.direction} />
            <Field label="Campaign" value={detail.row.campaign} />
            <Field label="Date / Time" value={fmtDateTime(detail.row.at)} />
            <Field label="Duration" value={detail.info?.durationSec ? fmtDuration(detail.info.durationSec) : detail.row.durationSec ? fmtDuration(detail.row.durationSec) : null} />
            <Field label="Status" value={detail.info?.status || detail.row.recordingStatus} />
          </div>
          <div style={{ marginTop: 14, background: "var(--hub-bg-soft)", border: "1px solid var(--hub-border)", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "var(--hub-muted)" }}>
            {detail.loading ? (
              "Loading…"
            ) : detail.info?.url ? (
              <>
                <audio controls autoPlay src={detail.info.url} style={{ width: "100%" }} />
                <a href={detail.info.url} target="_blank" rel="noreferrer" className="hub-link-btn" style={{ display: "inline-flex", gap: 6, marginTop: 8, fontSize: 12 }}>
                  <DownloadOutlined /> Download
                </a>
              </>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ClockCircleOutlined /> No recording for this call.
              </span>
            )}
          </div>
        </HubModal>
      )}
    </div>
  );
}

function Kpi({ icon, color, value, label, sub, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        flex: "1 1 170px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
        background: "var(--hub-surface)",
        border: `1px solid ${active ? color : "var(--hub-border)"}`,
        boxShadow: active ? `0 0 0 3px ${color}22` : "none",
        borderRadius: 14,
        padding: "14px 16px",
        color: "inherit",
      }}
    >
      <span style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", background: `${color}1a`, color, fontSize: 18, flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 22, fontWeight: 700, color: "var(--hub-text)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <span style={{ display: "block", fontSize: 12, color: "var(--hub-muted)" }}>{label}</span>
        {sub && <span style={{ display: "block", fontSize: 11, color, fontWeight: 600, marginTop: 1 }}>{sub}</span>}
      </span>
    </button>
  );
}

function Chip({ label, onClear }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "var(--hub-blue-soft)", color: "var(--hub-blue)", fontSize: 12, fontWeight: 600 }}>
      {label}
      <button type="button" onClick={onClear} aria-label={`Remove ${label}`} style={{ border: "none", background: "transparent", cursor: "pointer", color: "inherit", padding: 0, display: "inline-flex" }}>
        <CloseOutlined style={{ fontSize: 10 }} />
      </button>
    </span>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--hub-muted)", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 13.5, color: "var(--hub-text)" }}>{value || "—"}</div>
    </div>
  );
}
