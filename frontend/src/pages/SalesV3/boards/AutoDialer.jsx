import React, { useEffect, useRef, useState } from "react";
import { message } from "antd";
import { useSelector } from "react-redux";
import { request } from "@/request";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { usePoll } from "@/pages/Calling/shared";
import { Head, Modal, Pager, Empty, Skel, nf, talk, hm, fmtWhen } from "../ui";
import { LeadLnk, AgentLnk } from "../popups/Popups";
import { CallerDetail, SendProspect, PoolStages } from "../popups/CallPopups";

// v3 design — S3AutoDialer. Data (same as before):
//   calling/lead-pool/status (4 s) · toggle · break/start · stage · connect-mode · line/connect
//   calling/agent/active (2 s while on) — the live call strip
//   workday/admin/360/dialer-report?from&to — live dialer numbers
//   calling/lead-pool/used-leads — every call (mine / everyone), facets for the chips
const MODES = [
  ["classic", "Ring mobile per call", "Your phone rings per answered call", "mobile"],
  ["alwaysOn", "Always-on agent line", "One open line, customers join it", "line"],
  ["browser", "Browser phone", "Talk from this browser", "browser"],
];
const NON_SALES = ["Teacher", "Student", "Support"];
const ist0 = (off) => {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + off) - 5.5 * 3600e3);
};
const monthStart = (off) => {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + off, 1) - 5.5 * 3600e3);
};
const RANGES = [
  ["today", "Today", () => [ist0(0), new Date()], "today"],
  ["yesterday", "Yesterday", () => [ist0(-1), new Date(ist0(0).getTime() - 1000)], "yesterday"],
  ["7", "1 Week", () => [ist0(-6), new Date()], "7"],
  ["15", "15 Days", () => [ist0(-14), new Date()], "15"],
  ["30", "30 Days", () => [ist0(-29), new Date()], "30"],
  ["month", "This Month", () => [monthStart(0), new Date()], "month"],
  ["lastmonth", "Last Month", () => [monthStart(-1), new Date(monthStart(0).getTime() - 1000)], "lastmonth"],
  ["90", "3 Months", () => [ist0(-89), new Date()], "90"],
  ["365", "1 Year", () => [ist0(-364), new Date()], "365"],
  ["all", "All time", () => [ist0(-399), new Date()], "365"],
  ["custom", "Custom dates", null, "custom"],
];
const dayStart = (k) => new Date(`${k}T00:00:00+05:30`);
const dayEnd = (k) => new Date(`${k}T23:59:59.999+05:30`);
// share of today's calling hours (10:00–20:00 IST) already gone
const callingDone = () => {
  const ist = new Date(Date.now() + 5.5 * 3600e3);
  const min = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return Math.max(0, Math.min(100, ((min - 600) / 600) * 100));
};
const OUTS = [["", "All calls"], ["connected", "Connected"], ["notpicked", "Not picked up"], ["missed", "Missed"], ["callback", "Callback"], ["interested", "Interested"], ["prospect", "Prospects"], ["demo", "Demo Booking"], ["enrolled", "Enrolled"]];
const TYPES = [["", "All call types"], ["pool", "Lead pool"], ["dialer", "Dialer / callbacks"], ["facebook", "Facebook leads"], ["inbound", "Inbound"]];
const OUT_B = { connected: "b gr", notpicked: "b gy", missed: "b rd", callback: "b or", interested: "b bl", prospect: "b tl", demo: "b bl", enrolled: "b gr" };
// line icons (same stroke style as the design sidebar)
const IP = {
  play: "M7 4l13 8-13 8z",
  stop: "M6 6h12v12H6z",
  coffee: "M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v3M10 2v3M14 2v3",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4l2.8.7a2 2 0 0 1 1.7 2z",
  mobile: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  line: "M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z",
  browser: "M3 4h18v14H3zM8 21h8M12 18v3",
  layers: "M12 2l10 6-10 6L2 8zM2 14l10 6 10-6",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  pulse: "M22 12h-4l-3 9L9 3l-3 9H2",
  gauge: "M12 14l4-4M3.3 19a10 10 0 1 1 17.4 0z",
  target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  zap: "M13 2L3 14h9l-1 8 10-12h-9z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  mic: "M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  cal: "M3 5h18v16H3zM16 3v4M8 3v4M3 10h18",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  check: "M20 6L9 17l-5-5",
  ratio: "M21.2 15.9A10 10 0 1 1 8 2.8M22 12A10 10 0 0 0 12 2v10z",
  phonein: "M16 2v6h6M22 2l-6 6M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4l2.8.7a2 2 0 0 1 1.7 2z",
  fb: "M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  checkc: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4L12 14l-3-3",
  signal: "M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16",
};
const Ico = ({ n, s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><path d={IP[n]} /></svg>
);
const TYPE_IC = { "Lead pool": "layers", Inbound: "phonein", "Facebook lead": "fb", Dialer: "phone" };
const H3 = ({ n, children }) => <h3 className="sv3-h3i"><span className="sv3-hi"><Ico n={n} s={15} /></span>{children}</h3>;
const clock = (v) => (v ? new Date(v).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }) : "—");
const pctC = (p) => (p == null ? "#94A3B8" : p >= 60 ? "#0F766E" : p >= 30 ? "#EA580C" : "#B42318");

export default function AutoDialer() {
  const me = useSelector(selectCurrentAdmin);
  const isSales = !NON_SALES.includes(me?.role);
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState("");
  const [active, setActive] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [modal, setModal] = useState(null);
  const autoJoining = useRef(false);
  // live numbers
  const [scope, setScope] = useState(["Owner", "Admin", "Super Admin", "Sales Manager", "Team Manager"].includes(me?.role) ? "all" : "mine");
  const [range, setRange] = useState("today");
  const [cr, setCr] = useState({ from: "", to: "" });
  const [rep, setRep] = useState(null);
  // list
  const [out, setOut] = useState("");
  const [lf, setLf] = useState({ type: "", agent: "", disposition: "", from: "", to: "", q: "" });
  const [qIn, setQIn] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState(null);
  const [dialing, setDialing] = useState("");

  const load = async () => {
    if (!isSales) return;
    const r = await request.get({ entity: "calling/lead-pool/status" });
    if (r?.success) setSt(r.result);
  };
  usePoll(load, 4000, [isSales]);
  const on = !!st?.on;
  // auto-join once a day in the shift's join window (only while this page is open) — same rule as before
  useEffect(() => {
    if (!st?.shift?.shouldAutoJoin || autoJoining.current) return;
    autoJoining.current = true;
    request.post({ entity: "calling/lead-pool/toggle", jsonData: { on: true } }).finally(() => {
      autoJoining.current = false;
      load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.shift?.shouldAutoJoin]);
  usePoll(async () => {
    if (!isSales || !on) return setActive(null);
    const r = await request.get({ entity: "calling/agent/active" });
    setActive(r?.success ? r.result : null);
  }, 2000, [isSales, on]);
  useEffect(() => {
    if (!active?.call) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active?.call?._id]);

  useEffect(() => {
    let live = true;
    if (range === "custom" && !(cr.from && cr.to)) return undefined;
    setRep(null);
    const [from, to] = range === "custom" ? [dayStart(cr.from), dayEnd(cr.to)] : (RANGES.find((r) => r[0] === range) || RANGES[0])[2]();
    request.get({ entity: `workday/admin/360/dialer-report?from=${from.toISOString()}&to=${to.toISOString()}` }).then((r) => live && setRep(r?.success ? r.result : { rows: [], totals: {} }));
    return () => {
      live = false;
    };
  }, [range, cr]);

  useEffect(() => {
    const t = setTimeout(() => {
      setLf((x) => ({ ...x, q: qIn.trim() }));
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [qIn]);
  usePoll(async () => {
    const extra = Object.fromEntries(Object.entries(lf).filter(([, v]) => v));
    const r0 = RANGES.find((r) => r[0] === range) || RANGES[0];
    const qs = new URLSearchParams({ view: "calls", items: "20", page: String(page), range: r0[3], days: String(Number(r0[3]) || (range === "today" || range === "yesterday" ? 1 : 30)), ...(range === "custom" && cr.from && cr.to ? { from: cr.from, to: cr.to } : {}), ...(out ? { outcome: out } : {}), ...extra });
    const r = await request.get({ entity: `calling/lead-pool/used-leads?${qs}` });
    if (r?.success) setList({ rows: r.result || [], facets: r.facets || null, pg: r.pagination || null, mine: r.scope === "mine" });
    else setList((l) => l || { rows: [], facets: null, pg: null, mine: true, error: true });
  }, 10000, [out, lf, page, range, cr]);

  if (!isSales) return <Empty text="The Auto Dialer is for Sales users." />;

  const toggle = async () => {
    setBusy("toggle");
    const fresh = await request.get({ entity: "calling/lead-pool/status" });
    const cur = fresh?.success ? !!fresh.result.on : on;
    const r = await request.post({ entity: "calling/lead-pool/toggle", jsonData: { on: !cur } });
    if (!r?.success) message.error(r?.message || "Could not change your Instant Lead Pool status.");
    await load();
    setBusy("");
  };
  const startBreak = async () => {
    const key = st?.shift?.activeBreak?.key;
    if (!key) return;
    setBusy("break");
    const r = await request.post({ entity: "calling/lead-pool/break/start", jsonData: { key } });
    if (!r?.success) message.error(r?.message || "Could not start the break.");
    await load();
    setBusy("");
  };
  const setMode = async (mode) => {
    setBusy("mode");
    const r = await request.post({ entity: "calling/lead-pool/connect-mode", jsonData: { mode } });
    if (!r?.success) message.error(r?.message || "Could not change the connect mode.");
    await load();
    setBusy("");
    setModal(null);
  };
  const lineConnect = async () => {
    setBusy("line");
    const r = await request.post({ entity: "calling/lead-pool/line/connect", jsonData: {} });
    if (!r?.success) message.error(r?.message || "Could not call your phone.");
    await load();
    setBusy("");
  };
  const saveStages = async (stages) => {
    setBusy("stages");
    const r = await request.post({ entity: "calling/lead-pool/stage", jsonData: { stages } });
    if (!r?.success) message.error(r?.message || "Could not change the dialing stages.");
    else setModal(null);
    await load();
    setBusy("");
  };
  const exportCalls = async () => {
    setDialing("export");
    const hide = message.loading("Preparing the CSV…", 0);
    try {
      const extra = Object.fromEntries(Object.entries(lf).filter(([, v]) => v));
      const r0 = RANGES.find((r) => r[0] === range) || RANGES[0];
      const rows = [];
      for (let pg = 1; pg <= 100; pg += 1) {
        const qs = new URLSearchParams({ view: "calls", items: "100", page: String(pg), range: r0[3], days: String(Number(r0[3]) || (range === "today" || range === "yesterday" ? 1 : 30)), ...(range === "custom" && cr.from && cr.to ? { from: cr.from, to: cr.to } : {}), ...(out ? { outcome: out } : {}), ...extra });
        const r = await request.get({ entity: `calling/lead-pool/used-leads?${qs}` });
        if (!r?.success) throw new Error(r?.message || "Could not load the calls.");
        rows.push(...(r.result || []));
        if (pg >= (r.pagination?.pages || 1)) break;
      }
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const head = ["When", "Lead", "Phone", "Agent", "Type", "Result", "Talk (s)", "Stage", "Sub-status", "Disposition", "Notes"];
      const lines = rows.map((l) => [l.lastAttemptAt ? new Date(l.lastAttemptAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "", l.name, l.phone, l.agentName || "", l.type, l.response || l.outcome, l.durationSec || 0, l.stage, l.subStatus, l.disposition, l.notes].map(esc).join(","));
      const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `dialer-calls-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      message.success(`${nf(rows.length)} calls exported.`);
    } catch (e) {
      message.error(e.message || "Export failed.");
    } finally {
      hide();
      setDialing("");
    }
  };

  const mode = st?.connectMode || "classic";
  const queue = st?.stageQueue?.length ? st.stageQueue : (st?.stages || [st?.stage || "New Lead"]).map((s) => ({ stage: s, left: null }));
  const call = active?.call;
  const callSec = call?.answeredAt ? Math.max(0, Math.floor((now - new Date(call.answeredAt)) / 1000)) : 0;
  const statusText = !st
    ? "Loading…"
    : !on
    ? "Dialer OFF"
    : st.shift?.onBreak
    ? `On break — dialer paused · back at ${clock(st.shift.breakUntil)}`
    : call
    ? call.answeredAt
      ? `On a call · ${active?.lead?.name || call.phone || ""} · ${Math.floor(callSec / 60)}:${String(callSec % 60).padStart(2, "0")}`
      : `Ringing · ${active?.lead?.name || call.phone || ""}`
    : st.myStatus === "Paused" ? "Dialer ON — paused" : "Dialer ON — next lead dials when you are free";
  const worked = st?.shift?.workedMinutesToday || 0;
  const target = st?.shift?.targetWorkMinutes || 0;
  // live numbers: everyone (report totals) or me (my row)
  const myRow = (rep?.rows || []).find((r) => String(r.adminId) === String(me?._id));
  const t = scope === "mine" ? myRow || {} : rep?.totals || {};
  const a = rep?.assumptions || {};
  const cph = t.dialerMin ? Math.round(((t.calls || 0) / (t.dialerMin / 60)) * 10) / 10 : null;
  const connectRate = t.calls ? Math.round(((t.connected || 0) / t.calls) * 100) : null;
  const perDay = rep?.totals?.perDay;
  const daysToClear = perDay && st?.leadsWaiting ? Math.ceil(st.leadsWaiting / perDay) : null;
  const tiles = [
    ["Full-shift capacity", t.shiftRatio != null ? `${t.shiftRatio}% used` : "—", `${t.daysWorked || 0} person-days × 8h`, t.shiftRatio, "gauge"],
    ["Connect rate", connectRate != null ? `${connectRate}%` : "—", `${nf(t.connected)} of ${nf(t.calls)} calls`, connectRate, "target"],
    ["Calls / hour of dialer", cph ?? "—", `per person · max ${a.callsPerHourMax || "—"} an hour`, cph != null && a.callsPerHourMax ? (cph / a.callsPerHourMax) * 100 : null, "zap"],
    ["Dialer on", hm(t.dialerMin), `${t.dialerUse ?? (t.activeMin ? Math.round((t.dialerMin / t.activeMin) * 100) : "—")}% of logged-in time`, t.dialerUse ?? (t.activeMin ? (t.dialerMin / t.activeMin) * 100 : null), "clock"],
    ["Talk time", talk(t.talkSec), t.dialerMin ? `${Math.round((t.talkSec / 60 / t.dialerMin) * 100)}% of the callers’ dialer time` : "—", t.dialerMin ? (t.talkSec / 60 / t.dialerMin) * 100 : null, "mic"],
    ["Calls a day", nf(scope === "mine" ? (t.daysWorked ? Math.round((t.calls || 0) / t.daysWorked) : t.calls) : t.perDay), daysToClear ? `${nf(st.leadsWaiting)} leads waiting ≈ ${daysToClear} day${daysToClear > 1 ? "s" : ""} to clear` : "average per working day", null, "cal"],
  ];
  const conn = t.connected || 0;
  const missed = t.missed || 0;
  const notPicked = Math.max(0, (t.calls || 0) - conn - missed);
  const pc = (n) => (t.calls ? (n / t.calls) * 100 : 0);
  const facets = list?.facets;
  const mine = list ? list.mine : true;

  return (
    <>
      <Head crumb="Sales › Auto Dialer" title="Auto Dialer" lead="Start dialling, watch the live numbers, see every call — same as today, cleaner."><span className="src">calling/lead-pool/status · used-leads</span></Head>

      {/* Dialer card — design pasted by the user 2026-11-21 (dark gradient card:
          status ring · leads waiting · Start / Break · three stat tiles · break note).
          Same data and actions as before. */}
      <div className={`sv3-dc ${on ? "is-on" : "is-off"}`}>
        <div className="sv3-dc-shape one" aria-hidden="true" />
        <div className="sv3-dc-shape two" aria-hidden="true" />
        <div className="sv3-dc-dots" aria-hidden="true" />
        <div className="sv3-dc-grid">
          <section className="sv3-dc-left">
            <div className="sv3-dc-ring">
              <div className="sv3-dc-phone"><Ico n="phone" s={40} /></div>
              <div className="sv3-dc-pill">{on ? "ON" : "OFF"}<span className="sv3-dc-pdot" /></div>
            </div>
            <div className="sv3-dc-lead">
              <div className="sv3-dc-kicker"><span className="sv3-dc-sig"><Ico n="signal" s={18} /></span><span>{statusText}</span></div>
              <h2 className="sv3-dc-title">{st ? nf(st.leadsWaiting) : "—"} <span>Leads Waiting</span></h2>
              <div className="sv3-dc-sub" title={target ? `${hm(worked)} of ${hm(target)} worked today` : undefined}>
                <Ico n="clock" s={15} />
                {daysToClear ? <><span>≈ {daysToClear} day{daysToClear > 1 ? "s" : ""} to clear at today’s pace</span><span>•</span></> : null}
                <span>Calling hours 10:00–20:00</span>
              </div>
              <div className="sv3-dc-prog" role="img" aria-label={`${Math.round(callingDone())}% of calling hours done`}><b style={{ width: `${callingDone()}%` }} /></div>
              {st?.poolExhausted && <div className="sv3-dc-warn">Every stage in the order is finished — nothing left to dial.</div>}
            </div>
          </section>

          <section className="sv3-dc-actions">
            <button type="button" className={`sv3-dc-start ${on ? "stop" : ""}`} disabled={busy === "toggle" || !st} onClick={toggle}>
              {busy === "toggle" ? "…" : <><Ico n={on ? "stop" : "play"} s={19} /> <span>{on ? "Stop Dialer" : "Start Dialer"}</span></>}
            </button>
            {st?.shift?.onBreak ? (
              <button type="button" className="sv3-dc-break" disabled title="The dialer resumes by itself when the break ends"><Ico n="coffee" s={20} /> <span>On break · back at {clock(st.shift.breakUntil)}</span></button>
            ) : (
              <button type="button" className="sv3-dc-break" disabled={busy === "break" || !on || !st?.shift?.activeBreak || st.shift.activeBreak.taken} title={st?.shift?.activeBreak ? `${st.shift.activeBreak.label} · ${st.shift.activeBreak.durationMin} min` : "No break is open right now"} onClick={startBreak}>
                <Ico n="coffee" s={20} /> <span>{busy === "break" ? "Starting…" : "Take a Break"}</span>
              </button>
            )}
          </section>

          <section className="sv3-dc-right">
            <div className="sv3-dc-stats">
              <div className="sv3-dc-stat"><span className="sv3-dc-si blue"><Ico n="users" s={22} /></span><b>{st ? nf(st.leadsWaiting) : "—"}</b><small>Total Leads</small></div>
              <div className="sv3-dc-stat" title={connectRate != null ? `${nf(t.connected)} of ${nf(t.calls)} calls · ${scope === "mine" ? "yours" : "everyone"}` : undefined}><span className="sv3-dc-si green"><Ico n="checkc" s={22} /></span><b>{connectRate != null ? `${connectRate}%` : "—"}</b><small>Connect Rate</small></div>
              <div className="sv3-dc-stat"><span className="sv3-dc-si purple"><Ico n="cal" s={22} /></span><b>10:00–20:00</b><small>Calling Hours</small></div>
            </div>
            {/* A break opens only in its scheduled window (config/shiftSchedule) and only while the
                dialer runs — say why the button is off instead of a silent grey button. */}
            <div className="sv3-dc-note">
              <span className="sv3-dc-ni"><Ico n="info" s={14} /></span>
              <span>
                {!st
                  ? "Loading…"
                  : st.shift?.onBreak
                  ? `On break — the dialer resumes at ${clock(st.shift.breakUntil)}`
                  : !st.shift?.activeBreak
                  ? "No break is open right now — breaks open at their set times"
                  : st.shift.activeBreak.taken
                  ? `${st.shift.activeBreak.label} already taken today`
                  : !on
                  ? `Start the dialer to take the ${st.shift.activeBreak.label}`
                  : `${st.shift.activeBreak.label} is open now · ${st.shift.activeBreak.durationMin} min`}
              </span>
            </div>
          </section>
        </div>
      </div>

      {/* Connect mode + stage order are admin settings: a sales agent only sees
          their own line / browser-phone status (user ask 2026-11-20). */}
      {(st?.canSetConnectMode || st?.canSetStage) ? (
        <div className="g2">
          <div className="card">
            <div className="ch"><div><H3 n="phone">How an answered call reaches you</H3>{!st?.canSetConnectMode && <p>Set by Admin for everyone</p>}</div><span className="src">lead-pool/connect-mode</span></div>
            <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
              {MODES.map(([k, l, dsc, ic]) => (
                <button key={k} type="button" className={mode === k ? "sv3-mode on" : "sv3-mode"} disabled={!st?.canSetConnectMode || busy === "mode"} onClick={() => mode !== k && setModal({ kind: "mode", mode: k, label: l })}>
                  <span className="sv3-mi"><Ico n={ic} s={18} /></span><b>{l}</b>{dsc}
                </button>
              ))}
            </div>
            {mode === "alwaysOn" && (
              <div className="row" style={{ marginTop: 12 }}>
                <span className={st?.myLineLive ? "b gr" : "b gy"}>{st?.myLineLive ? "Your line is live" : "Your line is not connected"}</span>
                {!st?.myLineLive && <button type="button" className="btn" disabled={busy === "line"} onClick={lineConnect}><Ico n="phone" s={15} /> {busy === "line" ? "Calling your phone…" : "Connect agent line"}</button>}
              </div>
            )}
            {mode === "browser" && <div className="row" style={{ marginTop: 12 }}><span className={st?.myBrowserReady ? "b gr" : "b or"}><Ico n={st?.myBrowserReady ? "check" : "info"} s={13} /> {st?.myBrowserReady ? "Browser phone ready" : "Browser phone not ready — keep this tab open"}</span></div>}
          </div>
          <div className="card">
            <div className="ch"><div><H3 n="layers">Stages dialled, in order</H3></div>{st?.canSetStage && <button type="button" className="btn sm" onClick={() => setModal({ kind: "stages" })}><Ico n="edit" s={14} /> Change stages</button>}</div>
            <div className="row" style={{ gap: 8 }}>
              {queue.map((q, i) => (
                <span key={q.stage} className={q.active || i === 0 ? "b tl" : "b gy"} title={q.left != null ? `${q.left} left` : undefined}>
                  {i + 1} · {q.stage}{q.left != null ? ` ${nf(q.left)}` : ""}
                </span>
              ))}
            </div>
            <p className="mut" style={{ fontSize: 12, margin: "8px 0 0" }}>Dial order: Facebook instant lead → callback due / inbound waiting → these stages.</p>
          </div>
        </div>
      ) : st ? (
        <>
          {mode === "alwaysOn" && (
            <div className="row" style={{ marginTop: 0 }}>
              <span className={st?.myLineLive ? "b gr" : "b gy"}>{st?.myLineLive ? "Your line is live" : "Your line is not connected"}</span>
              {!st?.myLineLive && <button type="button" className="btn" disabled={busy === "line"} onClick={lineConnect}><Ico n="phone" s={15} /> {busy === "line" ? "Calling your phone…" : "Connect agent line"}</button>}
            </div>
          )}
          {mode === "browser" && <div className="row" style={{ marginTop: 0 }}><span className={st?.myBrowserReady ? "b gr" : "b or"}><Ico n={st?.myBrowserReady ? "check" : "info"} s={13} /> {st?.myBrowserReady ? "Browser phone ready" : "Browser phone not ready — keep this tab open"}</span></div>}
        </>
      ) : null}

      <div className="card">
        <div className="ch">
          <div><H3 n="pulse">Live dialer numbers</H3><p>{scope === "mine" ? "Your numbers" : "Every caller on the dialer"} · updates live while the dialer runs</p></div>
          <div className="row">
            <div className="seg" role="group" aria-label="Whose numbers">
              {[["mine", "Mine"], ["all", "Everyone"]].map(([k, l]) => <button key={k} type="button" className={scope === k ? "on" : ""} onClick={() => setScope(k)}>{l}</button>)}
            </div>
            <select className="sel" style={{ width: "auto", minHeight: 36 }} aria-label="Range" value={range} onChange={(e) => { setRange(e.target.value); setPage(1); }}>
              {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {range === "custom" && (
              <>
                <input className="in" type="date" aria-label="From" style={{ width: "auto", minHeight: 36 }} value={cr.from} max={cr.to || undefined} onChange={(e) => { setCr({ ...cr, from: e.target.value }); setPage(1); }} />
                <input className="in" type="date" aria-label="To" style={{ width: "auto", minHeight: 36 }} value={cr.to} min={cr.from || undefined} onChange={(e) => { setCr({ ...cr, to: e.target.value }); setPage(1); }} />
              </>
            )}
          </div>
        </div>
        {range === "custom" && !(cr.from && cr.to) ? <Empty text="Pick both dates." /> : !rep ? <Skel h={160} /> : (
          <>
            <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
              {tiles.map(([l, v, s, g, ic]) => (
                <div key={l} className="kpi">
                  <div className="l"><i><Ico n={ic} s={14} /></i>{l}</div>
                  <div className="v">{v}</div>
                  <div className="d mut">{s}</div>
                  <div className="gauge"><b style={{ width: `${Math.max(0, Math.min(100, g || 0))}%`, background: pctC(g) }} /></div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b style={{ fontSize: 13.5, display: "inline-flex", gap: 6, alignItems: "center" }}><Ico n="ratio" s={15} /> Connect ratio · {nf(conn)} of {nf(t.calls)} calls</b>
                <div className="legend"><span><i className="dot" style={{ background: "#0F766E" }} />Connected</span><span><i className="dot" style={{ background: "#94A3B8" }} />Not picked up</span><span><i className="dot" style={{ background: "#EA580C" }} />Missed by agent</span></div>
              </div>
              {t.calls ? (
                <div className="sv3-ratio" role="img" aria-label="Connect ratio">
                  <span style={{ width: `${pc(conn)}%`, background: "#0F766E" }}>{Math.round(pc(conn))}%</span>
                  <span style={{ width: `${pc(notPicked)}%`, background: "#94A3B8" }}>{Math.round(pc(notPicked))}%</span>
                  <span style={{ width: `${Math.max(4, pc(missed))}%`, background: "#EA580C" }}>{Math.round(pc(missed))}%</span>
                </div>
              ) : <div className="mut" style={{ marginTop: 8 }}>No calls in this range.</div>}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="ch"><div><H3 n="list">{mine ? "My calls" : "All calls"}</H3><p>{mine ? "Every call of yours — auto-dialer, dialer and callbacks: connected, not picked up, or missed by you." : "Every call made by every user — lead pool, Dialer, callbacks, Facebook leads — with the response they saved."}</p></div><button type="button" className="btn sm" disabled={dialing === "export" || !list?.pg?.count} onClick={exportCalls}><Ico n="download" s={14} /> {dialing === "export" ? "Exporting…" : "Export"}</button></div>
        <div className="sv3-chipf" role="group" aria-label="Result">
          {OUTS.map(([k, l]) => {
            const n = !facets ? null : k === "" ? facets.total : facets.outcome?.[k];
            return <button key={k || "all"} type="button" className={out === k ? "on" : ""} onClick={() => { setOut(k); setPage(1); }}>{k === "missed" && mine ? "Missed by me" : k === "missed" ? "Missed by agent" : l}{n != null ? ` · ${nf(n)}` : ""}</button>;
          })}
        </div>
        <div className="fgrid" style={{ marginTop: 10 }}>
          <label className="fld">Call type<select className="sel" value={lf.type} onChange={(e) => { setLf({ ...lf, type: e.target.value }); setPage(1); }}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {!mine && <label className="fld">Agent<select className="sel" value={lf.agent} onChange={(e) => { setLf({ ...lf, agent: e.target.value }); setPage(1); }}><option value="">All agents</option>{(facets?.agents || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
          <label className="fld">Disposition<select className="sel" value={lf.disposition} onChange={(e) => { setLf({ ...lf, disposition: e.target.value }); setPage(1); }}><option value="">All</option><option value="none">No disposition</option>{(facets?.dispositions || []).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="fld">From<input className="in" type="date" value={lf.from} onChange={(e) => { setLf({ ...lf, from: e.target.value }); setPage(1); }} /></label>
          <label className="fld">To<input className="in" type="date" value={lf.to} onChange={(e) => { setLf({ ...lf, to: e.target.value }); setPage(1); }} /></label>
          <label className="fld">Search<input className="in" placeholder="Search name, phone or notes" value={qIn} onChange={(e) => setQIn(e.target.value)} /></label>
        </div>
        {!list ? <Skel h={240} /> : (
          <>
            <div className="tw" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th scope="col">When</th><th scope="col">Lead</th><th scope="col">Agent</th><th scope="col">Type</th><th scope="col">Result</th><th scope="col" className="num">Talk</th><th scope="col">Response saved</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th></tr></thead>
                <tbody>
                  {list.rows.map((l) => (
                    <tr key={l._id}>
                      <td>{fmtWhen(l.lastAttemptAt)}</td>
                      <td><LeadLnk phone={l.phone} ink>{l.name || "—"}</LeadLnk><div><LeadLnk phone={l.phone} /></div></td>
                      <td>{mine ? <AgentLnk adminId={me?._id} name={[me?.name, me?.surname].filter(Boolean).join(" ")}>Me</AgentLnk> : l.agentName ? <AgentLnk name={l.agentName} /> : "—"}</td>
                      <td><span className="sv3-type"><i><Ico n={TYPE_IC[l.type] || "phone"} s={13} /></i>{l.type || "—"}</span></td>
                      <td><span className={OUT_B[l.outcome] || "b gy"}>{l.response || l.outcome || "—"}</span></td>
                      <td className="num">{l.durationSec ? talk(l.durationSec) : "—"}</td>
                      <td style={{ whiteSpace: "normal", minWidth: 180 }}>
                        <b>{l.stage || "—"}</b>{l.subStatus && <span className="mut"> · {l.subStatus}</span>}
                        {l.disposition && <div className="mut" style={{ fontSize: 12 }}>{l.disposition}</div>}
                        {mine && (l.reviewers || []).map((p) => <div key={p.agent} style={{ fontSize: 12, color: p.connected ? "#0B7A55" : "#475467" }}>{p.name}: {p.connected ? `talked ${talk(p.talkSec)}` : p.calls ? "called, no answer" : "not called yet"}</div>)}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                          {mine && <button type="button" className="btn sm" onClick={() => setModal({ kind: "detail", id: l._id, name: l.name })}><Ico n="info" s={14} /> Details</button>}
                          {mine && l.prospect === "pending" && <button type="button" className="btn sm p" onClick={() => setModal({ kind: "send", call: { id: l._id, name: l.name } })}><Ico n="send" s={14} /> Send for verification</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.rows.length === 0 && <div style={{ marginTop: 10 }}><Empty /></div>}
            {list.pg && list.pg.count > 0 && <Pager page={list.pg.page || page} pages={list.pg.pages} count={list.pg.count} per={20} onPage={setPage} noun="calls" />}
          </>
        )}
      </div>

      {modal?.kind === "mode" && (
        <Modal
          title={`Switch everyone to “${modal.label}”?`}
          sub="Changes how a customer who answers reaches every agent in the pool"
          onClose={() => setModal(null)}
          width={480}
          footer={<><button type="button" className="btn g" onClick={() => setModal(null)}>Cancel</button><button type="button" className="btn p" disabled={busy === "mode"} onClick={() => setMode(modal.mode)}>Switch</button></>}
        >
          <div className="mut">{MODES.find((m) => m[0] === modal.mode)?.[2]}.</div>
        </Modal>
      )}
      {modal?.kind === "stages" && <PoolStages options={st?.stageOptions || []} current={st?.stages || [st?.stage || "New Lead"]} max={st?.maxStages || 5} saving={busy === "stages"} onClose={() => setModal(null)} onSave={saveStages} />}
      {modal?.kind === "detail" && <CallerDetail callId={modal.id} title={modal.name} onClose={() => setModal(null)} />}
      {modal?.kind === "send" && <SendProspect call={modal.call} onClose={() => setModal(null)} onSent={() => { setModal(null); message.success("Sent for verification."); }} />}
    </>
  );
}
