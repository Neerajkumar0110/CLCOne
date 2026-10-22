import React, { useState, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { request } from "@/request";
import { ThunderboltOutlined, PoweroffOutlined, CoffeeOutlined, ClockCircleOutlined, LeftOutlined, RightOutlined, PhoneOutlined } from "@ant-design/icons";
import { CALL_STATUS_BADGE, fmtDuration, fmtDateTime, usePoll } from "./shared";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import PoolStagesModal from "./PoolStagesModal";
import CallerDetailModal from "./CallerDetailModal";
import { STAGE_NAMES } from "@/config/leadStages";

// My Calls: the call-again button shows only for leads worth calling back.
const CALLABLE_STAGES = ["Interested Leads", "Demo Booking"];

const CONNECT_MODES = [
  { key: "classic", label: "Ring mobile per call" },
  { key: "alwaysOn", label: "Always-on agent line" },
  { key: "browser", label: "Browser phone" },
];

function fmtHm(totalMinutes) {
  const m = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function fmtClock(v) {
  if (!v) return "";
  return new Date(v).toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}

// Mirrors backend/src/config/roles.js's NON_SALES_ROLES — the Instant Lead
// Pool is Sales-only, so Support/Finance/LMS accounts never see the toggle.
const NON_SALES_ROLES = ["Support", "Finance", "Teacher", "Student"];

const MY_OUTCOMES = [
  { key: "", label: "All calls" },
  { key: "connected", label: "Connected" },
  { key: "notpicked", label: "Not picked up" },
  { key: "missed", label: "Missed by me" },
  { key: "callback", label: "Callback" },
  { key: "interested", label: "Interested" },
  { key: "demo", label: "Demo Booking" },
  { key: "enrolled", label: "Enrolled" },
];
const MY_RANGES = [
  { key: 7, label: "1 Week" },
  { key: 15, label: "15 Days" },
  { key: 30, label: "1 Month" },
];
const OUTCOME_BADGE = { connected: "hub-badge-green", notpicked: "hub-badge-yellow", missed: "hub-badge-red" };

// Management's "All calls" view (backend leadPool.js allCalls): every
// finished call by every user — pool, Dialer, callbacks, Facebook leads,
// inbound — with the response the agent saved and the lead's stage now.
const ALL_OUTCOMES = [
  { key: "", label: "All" },
  { key: "connected", label: "Connected" },
  { key: "notpicked", label: "Not picked up" },
  { key: "missed", label: "Missed by agent" },
  { key: "callback", label: "Callback" },
  { key: "interested", label: "Interested" },
  { key: "demo", label: "Demo Booking" },
  { key: "enrolled", label: "Enrolled" },
];
const ALL_TYPES = [
  { key: "", label: "All call types" },
  { key: "pool", label: "Lead pool" },
  { key: "dialer", label: "Dialer / callbacks" },
  { key: "facebook", label: "Facebook leads" },
  { key: "inbound", label: "Inbound" },
];
const ALL_RANGES = [
  { key: 7, label: "Last 7 days" },
  { key: 30, label: "Last 30 days" },
  { key: 90, label: "Last 90 days" },
  { key: 0, label: "All time" },
];
const EMPTY_CALL_FILTERS = { outcome: "", type: "", agent: "", disposition: "", from: "", to: "", q: "" };

function AllCallsList() {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState(EMPTY_CALL_FILTERS);
  const [days, setDays] = useState(30);
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ facets: null, pagination: null });
  const setFilter = (k, v) => {
    setF((p) => ({ ...p, [k]: v }));
    setPage(1);
  };
  useEffect(() => {
    const t = setTimeout(() => setFilter("q", qInput.trim()), 400);
    return () => clearTimeout(t);
  }, [qInput]); // eslint-disable-line react-hooks/exhaustive-deps
  usePoll(async () => {
    const extra = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
    const qs = new URLSearchParams({ view: "calls", items: "50", page: String(page), days: String(days), ...extra });
    const r = await request.get({ entity: `calling/lead-pool/used-leads?${qs}` });
    if (r?.success) {
      setRows(r.result);
      setMeta({ facets: r.facets || null, pagination: r.pagination || null });
    }
  }, 15000, [f, page, days]);

  const facets = meta.facets;
  const pg = meta.pagination;
  const anyFilter = Object.values(f).some(Boolean);
  const countFor = (k) => (!facets ? null : k === "" ? facets.total : facets.outcome?.[k]);

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {ALL_OUTCOMES.map((o) => {
          const n = countFor(o.key);
          return (
            <button
              key={o.key || "all"}
              type="button"
              className={`hub-btn ${f.outcome === o.key ? "hub-btn-primary" : ""}`}
              style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12.5 }}
              onClick={() => setFilter("outcome", o.key)}
            >
              {o.label}
              {n != null ? ` · ${n}` : ""}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input className="hub-input" style={{ width: 200 }} placeholder="Search name, phone or notes" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        <select className="hub-select" style={{ width: 170 }} value={f.type} onChange={(e) => setFilter("type", e.target.value)}>
          {ALL_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select className="hub-select" style={{ width: 160 }} value={f.agent} onChange={(e) => setFilter("agent", e.target.value)}>
          <option value="">All agents</option>
          {(facets?.agents || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="hub-select" style={{ width: 170 }} value={f.disposition} onChange={(e) => setFilter("disposition", e.target.value)}>
          <option value="">All dispositions</option>
          <option value="none">No disposition</option>
          {(facets?.dispositions || []).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {!f.from && !f.to && (
          <select className="hub-select" style={{ width: 140 }} value={days} onChange={(e) => { setDays(Number(e.target.value)); setPage(1); }}>
            {ALL_RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        )}
        <input type="date" className="hub-input" style={{ width: 150 }} value={f.from} onChange={(e) => setFilter("from", e.target.value)} title="From" />
        <input type="date" className="hub-input" style={{ width: 150 }} value={f.to} onChange={(e) => setFilter("to", e.target.value)} title="To" />
        {anyFilter && (
          <button type="button" className="hub-btn" onClick={() => { setF(EMPTY_CALL_FILTERS); setQInput(""); setPage(1); }}>
            Clear
          </button>
        )}
      </div>
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead>
            <tr><th>Contact</th><th>Type</th><th>Response</th><th>Stage now</th><th>Disposition / notes</th><th>Agent</th><th>Talk</th><th>When</th></tr>
          </thead>
          <tbody>
            {(!rows || rows.length === 0) && (
              <tr><td colSpan={8}><div className="hub-empty">{rows ? (anyFilter ? "No calls match these filters." : "No calls in this range.") : "Loading…"}</div></td></tr>
            )}
            {rows && rows.map((l) => (
              <tr key={l._id}>
                <td>{l.name || "—"}<div style={{ fontSize: 11, color: "#94a3b8" }}>{l.phone}</div></td>
                <td style={{ fontSize: 12 }}>{l.type}</td>
                <td><span className={`hub-badge ${OUTCOME_BADGE[l.outcome] || "hub-badge-gray"}`}>{l.response}</span></td>
                <td style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 700 }}>{l.stage || "—"}</div>
                  {l.subStatus && <div style={{ color: "#94a3b8" }}>{l.subStatus}</div>}
                </td>
                <td style={{ fontSize: 12, maxWidth: 260 }}>
                  <div style={{ fontWeight: 700 }}>{l.disposition || "—"}</div>
                  {l.notes && <div style={{ color: "#64748b", whiteSpace: "pre-wrap" }}>{l.notes}</div>}
                </td>
                <td>{l.agentName || "—"}</td>
                <td>{l.durationSec ? fmtDuration(l.durationSec) : "—"}</td>
                <td>{l.lastAttemptAt ? fmtDateTime(l.lastAttemptAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pg && pg.pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 10, fontSize: 13 }}>
          <span style={{ color: "var(--hub-muted)" }}>{pg.count} calls · page {pg.page} of {pg.pages}</span>
          <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><LeftOutlined /></button>
          <button type="button" className="hub-btn" disabled={page >= pg.pages} onClick={() => setPage((p) => p + 1)}><RightOutlined /></button>
        </div>
      )}
    </>
  );
}

// Management (backend FULL_ACCESS_ROLES) gets every lead the pool has
// already attempted, pool-wide — the system-recorded response plus whatever
// disposition the agent picked. Everyone else gets every finished call of
// their own — auto-dialer, manual dialer, callbacks (server decides; the
// response says scope: "mine"), filterable by outcome and by the last
// week / 15 days / month.
function UsedLeads() {
  const [data, setData] = useState(null);
  const [mine, setMine] = useState(false);
  // Management: "pool" = Instant Lead Pool leads, "calls" = every call by every user.
  const [view, setView] = useState("calls");
  const [outcome, setOutcome] = useState("");
  const [days, setDays] = useState(7);
  const [dialingId, setDialingId] = useState(null);
  const [openCall, setOpenCall] = useState(null); // { id, name }
  // Management filters (pool-wide list) — backend leadPool.js usedLeads.
  const [f, setF] = useState({ response: "", stage: "", agent: "", disposition: "", from: "", to: "", q: "" });
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ facets: null, pagination: null });
  const setFilter = (k, v) => {
    setF((p) => ({ ...p, [k]: v }));
    setPage(1);
  };
  useEffect(() => {
    const t = setTimeout(() => setFilter("q", qInput.trim()), 400);
    return () => clearTimeout(t);
  }, [qInput]); // eslint-disable-line react-hooks/exhaustive-deps
  // One-click call back to any number in My Calls — the same manual dial as
  // the Dialer screen; the in-call modal opens by itself once it connects.
  const callAgain = async (l) => {
    if (dialingId) return;
    const phone = String(l.phone || "").replace(/[^\d+]/g, "");
    if (phone.replace(/\D/g, "").length < 8) return window.alert("No valid number on this call.");
    setDialingId(l._id);
    const r = await request.post({ entity: "calling/manual/dial", jsonData: { phone, contactName: l.name } });
    setDialingId(null);
    if (!r?.success) window.alert(r?.message || "Could not place the call.");
  };
  usePoll(async () => {
    // Management on the "All calls" tab: that list polls itself.
    if (view === "calls" && data && !mine) return;
    const extra = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
    const qs = new URLSearchParams({ items: "50", page: String(page), days: String(days), ...(outcome ? { outcome } : {}), ...extra });
    const r = await request.get({ entity: `calling/lead-pool/used-leads?${qs}` });
    if (r?.success) {
      setData(r.result);
      setMine(r.scope === "mine");
      setMeta({ facets: r.facets || null, pagination: r.pagination || null });
    }
  }, 8000, [outcome, days, f, page, view]);
  const facets = meta.facets;
  const pg = meta.pagination;
  const anyFilter = Object.values(f).some(Boolean);

  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <h3>{mine ? "My Calls" : "Used Leads"}</h3>
        {!mine && data && (
          <div className="hub-pill-filter">
            {[["calls", "All calls — every user"], ["pool", "Lead pool"]].map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`hub-btn ${view === k ? "hub-btn-primary" : ""}`}
                style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12.5, border: "none" }}
                onClick={() => setView(k)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 12 }}>
        {mine
          ? "Every call of yours — auto-dialer, dialer and callbacks: connected, not picked up, or missed by you."
          : view === "calls"
          ? "Every call made by every user — lead pool, Dialer, callbacks, Facebook leads — with the response they saved."
          : "Every lead the Instant Lead Pool has already dialed, and the response recorded for it."}
      </div>
      {!mine && data && view === "calls" ? (
        <AllCallsList />
      ) : (
      <>
      {mine && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <select className="hub-select" style={{ width: 170 }} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {MY_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <select className="hub-select" style={{ width: 130 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {MY_RANGES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
      )}
      {!mine && (
        <div style={{ marginBottom: 12 }}>
          {facets && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {[["", `All · ${facets.total}`], ...Object.entries(facets.response).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, `${k} · ${n}`])].map(([k, label]) => (
                <button
                  key={k || "all"}
                  type="button"
                  className={`hub-btn ${f.response === k ? "hub-btn-primary" : ""}`}
                  style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12.5 }}
                  onClick={() => setFilter("response", k)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input className="hub-input" style={{ width: 190 }} placeholder="Search name or phone" value={qInput} onChange={(e) => setQInput(e.target.value)} />
            <select className="hub-select" style={{ width: 170 }} value={f.stage} onChange={(e) => setFilter("stage", e.target.value)}>
              <option value="">All stages</option>
              {STAGE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="hub-select" style={{ width: 160 }} value={f.agent} onChange={(e) => setFilter("agent", e.target.value)}>
              <option value="">All agents</option>
              {(facets?.agents || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className="hub-select" style={{ width: 170 }} value={f.disposition} onChange={(e) => setFilter("disposition", e.target.value)}>
              <option value="">All dispositions</option>
              <option value="none">No disposition</option>
              {(facets?.dispositions || []).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input type="date" className="hub-input" style={{ width: 150 }} value={f.from} onChange={(e) => setFilter("from", e.target.value)} title="From" />
            <input type="date" className="hub-input" style={{ width: 150 }} value={f.to} onChange={(e) => setFilter("to", e.target.value)} title="To" />
            {anyFilter && (
              <button
                type="button"
                className="hub-btn"
                onClick={() => {
                  setF({ response: "", stage: "", agent: "", disposition: "", from: "", to: "", q: "" });
                  setQInput("");
                  setPage(1);
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
      {mine && <CallerDetailModal callId={openCall?.id} title={openCall?.name} onClose={() => setOpenCall(null)} />}
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead>
            <tr><th>Contact</th><th>Response</th><th>Stage</th><th>Disposition</th>{!mine && <th>Agent</th>}<th>Last Attempt</th>{mine && <th>Call</th>}</tr>
          </thead>
          <tbody>
            {(!data || data.length === 0) && (
              <tr><td colSpan={6}><div className="hub-empty">{mine ? "No calls in this range." : anyFilter ? "No leads match these filters." : "No leads dialed yet."}</div></td></tr>
            )}
            {data && data.map((l) => (
              <tr
                key={l._id}
                style={mine ? { cursor: "pointer" } : undefined}
                title={mine ? "Open full customer detail" : undefined}
                onClick={mine ? () => setOpenCall({ id: l._id, name: l.name }) : undefined}
              >
                <td>{l.name}<div style={{ fontSize: 11, color: "#94a3b8" }}>{l.phone}</div></td>
                <td>
                  <span className={`hub-badge ${(mine ? OUTCOME_BADGE[l.outcome] : CALL_STATUS_BADGE[l.response]) || "hub-badge-gray"}`}>
                    {l.response}
                  </span>
                </td>
                <td style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 700 }}>{l.stage || "—"}</div>
                  {mine && l.subStatus && <div style={{ color: "#94a3b8" }}>{l.subStatus}</div>}
                </td>
                <td>{l.disposition || "—"}</td>
                {!mine && <td>{l.agentName || "—"}</td>}
                <td>{l.lastAttemptAt ? fmtDateTime(l.lastAttemptAt) : "—"}</td>
                {mine && (
                  <td onClick={(e) => e.stopPropagation()}>
                    {CALLABLE_STAGES.includes(l.stage) && (
                    <button
                      type="button"
                      className="hub-btn"
                      title={`Call ${l.name || l.phone} now`}
                      disabled={!!dialingId}
                      onClick={() => callAgain(l)}
                      style={{ borderRadius: "50%", width: 36, height: 36, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#16a34a", borderColor: "#bbf7d0" }}
                    >
                      {dialingId === l._id ? "…" : <PhoneOutlined />}
                    </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!mine && pg && pg.pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 10, fontSize: 13 }}>
          <span style={{ color: "var(--hub-muted)" }}>
            {pg.count} leads · page {pg.page} of {pg.pages}
          </span>
          <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <LeftOutlined />
          </button>
          <button type="button" className="hub-btn" disabled={page >= pg.pages} onClick={() => setPage((p) => p + 1)}>
            <RightOutlined />
          </button>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// One-click power-dialer: join and it starts dialing straight from the
// Sales pipeline's own unassigned New Leads, distributing connected calls
// across everyone currently joined (see backend leadPool.js + the
// leadPoolSyncTick job that feeds it and notifies on exhaustion).
function InstantLeadPool() {
  const currentAdmin = useSelector(selectCurrentAdmin);
  const isSales = !NON_SALES_ROLES.includes(currentAdmin?.role);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [breakBusy, setBreakBusy] = useState(false);
  const [stageBusy, setStageBusy] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [lineBusy, setLineBusy] = useState(false);
  const [activeCall, setActiveCall] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [callsPage, setCallsPage] = useState(1);
  const CALLS_PAGE_SIZE = 10;
  const on = !!data?.on;
  // Guards against firing the auto-join POST more than once while its
  // response is still in flight — the next status poll (4s later) is what
  // actually clears shouldAutoJoin once the backend records today's join.
  const autoJoining = useRef(false);

  const load = async () => {
    if (!isSales) return;
    const r = await request.get({ entity: "calling/lead-pool/status" });
    if (r?.success) setData(r.result);
  };
  usePoll(load, 4000, [isSales]);

  // Auto-join the pool once per day during the shift's join window (see
  // config/shiftSchedule.js) — only while this page is actually open, since
  // "available for calls" has no meaning for someone not logged into the
  // CRM at all; opening the Calls page any time in the window joins them.
  useEffect(() => {
    if (!data?.shift?.shouldAutoJoin || autoJoining.current) return;
    autoJoining.current = true;
    request
      .post({ entity: "calling/lead-pool/toggle", jsonData: { on: true } })
      .finally(() => {
        autoJoining.current = false;
        load();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.shift?.shouldAutoJoin]);

  const startBreak = async (key) => {
    if (breakBusy) return;
    setBreakBusy(true);
    const r = await request.post({ entity: "calling/lead-pool/break/start", jsonData: { key } });
    if (!r?.success) window.alert(r?.message || "Could not start the break.");
    await load();
    setBreakBusy(false);
  };

  // Live "is a call actually going out right now" indicator — same endpoint
  // the manual Dialer screen polls, so a call this agent gets fed by the
  // pool shows up here exactly like a manually-dialled one would: Ringing
  // while Plivo is calling the customer, then Connected with a live timer.
  usePoll(async () => {
    if (!isSales || !on) {
      setActiveCall(null);
      return;
    }
    const r = await request.get({ entity: "calling/agent/active" });
    setActiveCall(r?.success ? r.result : null);
  }, 2000, [isSales, on]);

  useEffect(() => {
    if (!activeCall?.call) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeCall?.call?._id, activeCall?.call?.status]);

  if (!isSales) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    // Polling pauses while the tab is backgrounded, so `data.on` on screen
    // can be stale by the time the button is actually clicked — re-check
    // the server's own current state right before deciding which way to
    // flip, instead of trusting whatever was last polled.
    const fresh = await request.get({ entity: "calling/lead-pool/status" });
    const currentlyOn = fresh?.success ? !!fresh.result.on : !!data?.on;
    const r = await request.post({ entity: "calling/lead-pool/toggle", jsonData: { on: !currentlyOn } });
    if (!r?.success) window.alert(r?.message || "Could not change your Instant Lead Pool status.");
    await load();
    setBusy(false);
  };

  // Management only (backend decides via canSetStage): which Sales stages
  // the whole pool dials, in priority order (up to 5) — applies to every agent.
  const saveStages = async (stages) => {
    if (stageBusy || !stages.length) return;
    setStageBusy(true);
    const r = await request.post({ entity: "calling/lead-pool/stage", jsonData: { stages } });
    if (!r?.success) window.alert(r?.message || "Could not change the dialing stages.");
    else setStagesOpen(false);
    await load();
    setStageBusy(false);
  };
  // Admin / Super Admin only (backend: canSetConnectMode) — how a pool
  // customer who answers reaches the agent. See backend connectModes.js.
  const changeConnectMode = async (mode) => {
    if (modeBusy || !mode || mode === data?.connectMode) return;
    const label = CONNECT_MODES.find((m) => m.key === mode)?.label || mode;
    if (!window.confirm(`Switch every agent in the pool to "${label}"?`)) return;
    setModeBusy(true);
    const r = await request.post({ entity: "calling/lead-pool/connect-mode", jsonData: { mode } });
    if (!r?.success) window.alert(r?.message || "Could not change the connect mode.");
    await load();
    setModeBusy(false);
  };
  const reconnectLine = async () => {
    setLineBusy(true);
    const r = await request.post({ entity: "calling/lead-pool/line/connect", jsonData: {} });
    if (!r?.success) window.alert(r?.message || "Could not call your phone.");
    await load();
    setLineBusy(false);
  };
  const connectMode = data?.connectMode || "classic";

  const stageQueue = data?.stageQueue?.length
    ? data.stageQueue
    : (data?.stages || [data?.stage || "New Lead"]).map((s) => ({ stage: s, left: null, active: s === (data?.stage || "New Lead") }));

  const call = activeCall?.call;
  const lead = activeCall?.lead;
  const isRinging = !!call && !call.answeredAt;
  const isConnected = !!call && !!call.answeredAt;
  const callSeconds = isConnected ? Math.max(0, Math.floor((now - new Date(call.answeredAt).getTime()) / 1000)) : 0;

  const recentCalls = data?.recentCalls || [];
  const callsPages = Math.max(1, Math.ceil(recentCalls.length / CALLS_PAGE_SIZE));
  const callsPageClamped = Math.min(callsPage, callsPages);
  const pagedCalls = recentCalls.slice((callsPageClamped - 1) * CALLS_PAGE_SIZE, callsPageClamped * CALLS_PAGE_SIZE);

  return (
    <div className="hub-stack">
      {data?.canSetStage && (
        <PoolStagesModal
          open={stagesOpen}
          onClose={() => setStagesOpen(false)}
          onSave={saveStages}
          options={data.stageOptions || []}
          current={data.stages || [data.stage || "New Lead"]}
          max={data.maxStages || 5}
          saving={stageBusy}
        />
      )}
      <div className="hub-card">
        <div className="hub-card-header">
          <h3><ThunderboltOutlined /> Instant Lead Pool</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {data?.canSetConnectMode && (
            <select
              className="hub-select"
              style={{ width: 230 }}
              value={connectMode}
              disabled={modeBusy}
              title="How a customer who answers reaches the agent — Admin / Super Admin only"
              onChange={(e) => changeConnectMode(e.target.value)}
            >
              {CONNECT_MODES.map((m) => (
                <option key={m.key} value={m.key}>Connect: {m.label}</option>
              ))}
            </select>
          )}
          {data?.canSetStage && (
            <button
              type="button"
              className="hub-btn"
              disabled={stageBusy}
              title="Which stages the pool dials, in order — applies to every agent"
              onClick={() => setStagesOpen(true)}
            >
              Dialing stages ({(data.stages || []).length || 1}) ✎
            </button>
          )}
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            title={on ? "You're in the pool — click to stop" : "Click to join and start receiving calls"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 14px 6px 8px",
              borderRadius: 999,
              border: `1px solid ${on ? "#16a34a" : "#cbd5e1"}`,
              background: on ? "#16a34a" : "#f1f5f9",
              color: on ? "#fff" : "#475569",
              fontWeight: 700,
              fontSize: 13,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            <span style={{ width: 34, height: 20, borderRadius: 999, background: on ? "rgba(255,255,255,.35)" : "#cbd5e1", position: "relative" }}>
              <span style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
            </span>
            {busy ? "…" : on ? "ON — receiving calls" : "OFF — join to start"}
          </button>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 8 }}>
          Join and it dials straight from the stages below, in order, sending you the next customer the moment you're free — no campaign setup needed.
        </div>
        {/* How calls reach the agent right now (Admin / Super Admin pick it
            above) — shown to everyone so agents know how to take calls. */}
        {data && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 12.5 }}>
            <span style={{ color: "#64748b", fontWeight: 600 }}>Calls connect by:</span>
            <span
              style={{
                padding: "3px 10px", borderRadius: 999, fontWeight: 700,
                background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8",
              }}
            >
              {connectMode === "alwaysOn" ? "📞 " : connectMode === "browser" ? "🎧 " : "📱 "}
              {CONNECT_MODES.find((m) => m.key === connectMode)?.label || "Ring mobile per call"}
            </span>
            <span style={{ color: "#94a3b8" }}>
              {connectMode === "alwaysOn"
                ? "— we call your phone once when you join; stay on the line, customers join you with a beep."
                : connectMode === "browser"
                ? "— calls ring in this browser tab and pick up by themselves; keep the tab open with your headset on."
                : "— your mobile rings for every customer who picks up."}
            </span>
          </div>
        )}
        {/* Which stage is dialing right now, and what's next — shown to everyone. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 12 }}>
          {stageQueue.map((q, i) => (
            <React.Fragment key={q.stage}>
              {i > 0 && <span style={{ color: "#94a3b8", fontWeight: 700 }}>→</span>}
              <span
                title={q.active ? "Dialing now" : q.left === 0 ? "No leads left in this stage" : "Waiting its turn"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                  border: `1px solid ${q.active ? "#16a34a" : "#e2e8f0"}`,
                  background: q.active ? "#f0fdf4" : "#f8fafc",
                  color: q.active ? "#15803d" : q.left === 0 ? "#94a3b8" : "#475569",
                  textDecoration: !q.active && q.left === 0 ? "line-through" : "none",
                }}
              >
                <span style={{ fontSize: 11, opacity: 0.7 }}>{i + 1}</span>
                {q.active && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#16a34a" }} />}
                {q.stage === "New Lead" ? "New Lead (unassigned)" : q.stage}
                {q.left != null && <span style={{ fontWeight: 600, opacity: 0.8 }}>· {q.left}</span>}
                {q.active && <span style={{ fontSize: 11, fontWeight: 800 }}>DIALING NOW</span>}
              </span>
            </React.Fragment>
          ))}
        </div>

        {on && connectMode === "alwaysOn" && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12, fontSize: 13, fontWeight: 600,
              borderRadius: 10, padding: "8px 12px",
              background: data?.myLineLive ? "#f0fdf4" : "#fff7ed",
              border: `1px solid ${data?.myLineLive ? "#bbf7d0" : "#fed7aa"}`,
              color: data?.myLineLive ? "#15803d" : "#9a3412",
            }}
          >
            {data?.myLineLive
              ? "🎧 Your line is connected — keep your phone on, customers join you with a beep. Don't hang up between calls."
              : "📞 Your line isn't connected — pick up when we call your phone, or tap Reconnect."}
            {!data?.myLineLive && (
              <button type="button" className="hub-btn" disabled={lineBusy} onClick={reconnectLine}>
                {lineBusy ? "Calling…" : "Reconnect my line"}
              </button>
            )}
          </div>
        )}
        {on && connectMode === "browser" && (
          <div
            style={{
              marginBottom: 12, fontSize: 13, fontWeight: 600, borderRadius: 10, padding: "8px 12px",
              background: data?.myBrowserReady ? "#f0fdf4" : "#fff7ed",
              border: `1px solid ${data?.myBrowserReady ? "#bbf7d0" : "#fed7aa"}`,
              color: data?.myBrowserReady ? "#15803d" : "#9a3412",
            }}
          >
            {data?.myBrowserReady
              ? "🎧 Browser phone ready — calls pick up here automatically. Keep this tab open with your headset on."
              : "🎙 Starting the browser phone… allow microphone access if your browser asks."}
          </div>
        )}

        {on && data?.shift && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12.5, color: "#475569" }}>
            <ClockCircleOutlined />
            <span>
              Worked today: <b>{fmtHm(data.shift.workedMinutesToday)}</b> / {fmtHm(data.shift.targetWorkMinutes)}
            </span>
          </div>
        )}

        {on && data?.shift?.onBreak && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e",
              borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, fontWeight: 600,
            }}
          >
            <CoffeeOutlined /> On {data.shift.breakLabel || "a break"} — the dialer resumes by itself at {fmtClock(data.shift.breakUntil)}.
          </div>
        )}

        {on && !data?.shift?.onBreak && data?.shift?.activeBreak && !data.shift.activeBreak.taken && (
          <button
            type="button"
            onClick={() => startBreak(data.shift.activeBreak.key)}
            disabled={breakBusy}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
              background: "#ecfeff", border: "1px solid #a5f3fc", color: "#0e7490",
              borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13, fontWeight: 600,
              cursor: breakBusy ? "wait" : "pointer",
            }}
          >
            <CoffeeOutlined />
            {breakBusy ? "Starting…" : `${data.shift.activeBreak.label} — tap to go (${data.shift.activeBreak.durationMin} min, dialer pauses)`}
          </button>
        )}

        {on && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: call ? (isRinging ? "#fff7ed" : "#f0fdf4") : "#f8fafc",
              border: `1px solid ${call ? (isRinging ? "#fed7aa" : "#bbf7d0") : "#eef0f4"}`,
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 14,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: call ? (isRinging ? "#f59e0b" : "#16a34a") : "#94a3b8",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, fontSize: 13 }}>
              {call ? (
                <>
                  <strong>{isRinging ? "Ringing the customer…" : "Connected"}</strong>
                  {" — "}
                  {lead?.name || call.contactName || "Customer"}{" "}
                  <span style={{ color: "#94a3b8" }}>{lead?.phone || call.phone}</span>
                  {isConnected && (
                    <span style={{ marginLeft: 10, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {fmtDuration(callSeconds)}
                    </span>
                  )}
                </>
              ) : (
                <span style={{ color: "#64748b" }}>No active call right now — waiting for the next lead.</span>
              )}
            </div>
          </div>
        )}

        {data && data.poolExhausted && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, marginBottom: 12 }}>
            <PoweroffOutlined /> No leads left in {(data.stages || [data.stage || "New Lead"]).join(", ")} right now — it'll pick up automatically as new ones come in.
          </div>
        )}

        {data && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            {[
              ["Leads Waiting", data.leadsWaiting, "#2563EB"],
              ["Agents In Pool", data.participants, "#16A34A"],
              ["My Status", data.myStatus, on ? "#16A34A" : "#94A3B8"],
            ].map(([l, v, c]) => (
              <div key={l} style={{ flex: "1 1 130px", background: "#f8fafc", border: "1px solid #eef0f4", borderRadius: 12, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: c }} />
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{l}</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>My Calls Today</div>
        <div className="hub-table-wrapper">
          <table className="hub-table">
            <thead><tr><th>Contact</th><th>Duration</th><th>Status</th><th>Outcome</th></tr></thead>
            <tbody>
              {(!data || recentCalls.length === 0) && <tr><td colSpan={4}><div className="hub-empty">No calls yet today.</div></td></tr>}
              {data && pagedCalls.map((c) => (
                <tr key={c._id}>
                  <td>{c.contactName}<div style={{ fontSize: 11, color: "#94a3b8" }}>{c.phone}</div></td>
                  <td>{fmtDuration(c.durationSec)}</td>
                  <td><span className={`hub-badge ${CALL_STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                  <td>{c.disposition || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {callsPages > 1 && (
          <div className="hub-row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 10 }}>
            <span style={{ fontSize: 12.5, color: "var(--hub-muted)" }}>
              Page {callsPageClamped} of {callsPages} · {recentCalls.length} call{recentCalls.length === 1 ? "" : "s"}
            </span>
            <div className="hub-row" style={{ gap: 8 }}>
              <button type="button" className="hub-btn" disabled={callsPageClamped <= 1} onClick={() => setCallsPage(callsPageClamped - 1)}><LeftOutlined /> Prev</button>
              <button type="button" className="hub-btn" disabled={callsPageClamped >= callsPages} onClick={() => setCallsPage(callsPageClamped + 1)}>Next <RightOutlined /></button>
            </div>
          </div>
        )}
      </div>

      <UsedLeads />
    </div>
  );
}

export default function AutoDialer() {
  return <InstantLeadPool />;
}
