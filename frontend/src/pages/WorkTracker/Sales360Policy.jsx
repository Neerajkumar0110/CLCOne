import React, { useEffect, useState } from "react";
import { Input, message } from "antd";
import dayjs from "dayjs";
import {
  AimOutlined,
  AuditOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  FormOutlined,
  LeftOutlined,
  ReloadOutlined,
  RightOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { useSelector } from "react-redux";
import { request } from "@/request";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import HubModal from "@/components/HubModal";
import LeadFullDetailModal from "@/components/LeadFullDetail";
import { rowsToCsv, downloadCsv } from "@/components/dashboard/csvExport";

// The CLC-POL-001 parts of Sales 360° (backend /workday/admin/360/*): daily
// attendance by the policy's routes, every lead stage, prospect verification,
// targets + recovery Sundays, and everything a user did in one filterable list.

const n = (v) => (v || 0).toLocaleString("en-IN");
const hm = (min) => (min ? `${Math.floor(min / 60)}h ${min % 60}m` : "0m");
const talkText = (sec) => `${Math.floor(sec / 60)}m ${sec % 60}s`;
// "Poonam Kushwaha: talked 1m 7s, 3 calls" / "IDURAR Admin: not called yet"
const talkLine = (p) => (!p.calls ? "not called yet" : p.connected ? `talked ${talkText(p.talkSec)} · ${p.calls} call${p.calls === 1 ? "" : "s"}` : `${p.calls} call${p.calls === 1 ? "" : "s"}, no answer`);
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" }) : "—");

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
// The CRM's own popup, with Cancel + one action; `why` says why the action is off.
export function FormModal({ title, subtitle, okText, busy, why, onOk, onClose, children }) {
  return (
    <HubModal
      open
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      width={560}
      footer={
        <>
          {why && <span className="s3p-why">{why}</span>}
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" disabled={busy || !!why} onClick={onOk}>{busy ? "Saving…" : okText}</button>
        </>
      }
    >
      {children}
    </HubModal>
  );
}
function Pill({ color, children }) {
  return <span className="s3-pill" style={{ "--c": color }}>{children}</span>;
}

// ── attendance by the policy ─────────────────────────────────────────────
const RESULT = {
  present: ["Full day", "#15803D"],
  "half-day": ["Half day", "#0D9488"],
  absent: ["Absent", "#B91C1C"],
  "in-progress": ["In progress", "#0369A1"],
  leave: ["Leave", "#7C3AED"],
  auto: ["Auto-started", "#2563EB"],
  "late-leave": ["Leave (late login)", "#9333EA"],
};
const LEVEL_TO_STATUS = { full: "present", half: "half-day", absent: "absent" };
const LEVEL_COLOR = { full: "#15803D", half: "#0D9488", absent: "#64748B" };

function CorrectModal({ row, onClose, onSaved }) {
  const [form, setForm] = useState({ revisedStatus: "", revisedShortLeave: "", reason: "", requestedBy: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm({ revisedStatus: "", revisedShortLeave: "", reason: "", requestedBy: "" }), [row]);
  if (!row) return null;
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: "workday/admin/360/correct", jsonData: { adminId: row.adminId, dayKey: row.dayKey, ...form } });
    setBusy(false);
    if (r?.success) onSaved();
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <FormModal title={`Correct ${row.name}`} subtitle={dayjs(row.dayKey).format("D MMM YYYY")} okText="Save correction" busy={busy} why={form.reason.trim().length < 5 ? "Write the reason" : !form.revisedStatus && form.revisedShortLeave === "" ? "Change the status or short leave" : ""} onOk={save} onClose={onClose}>
      <p className="s3-note" style={{ marginTop: 0 }}>Right now: <b>{(RESULT[row.status] || [row.status])[0]}</b>, {row.shortLeave} short-leave event{row.shortLeave === 1 ? "" : "s"}. The original entry, your name and the time are kept.</p>
      <div className="s3p-form">
        <label>New day status
          <select className="hub-select" value={form.revisedStatus} onChange={set("revisedStatus")}>
            <option value="">No change</option>
            <option value="present">Full day</option>
            <option value="half-day">Half day</option>
            <option value="absent">Absent</option>
            <option value="leave">Leave</option>
          </select>
        </label>
        <label>Short-leave events on this day
          <Input type="number" min={0} max={4} value={form.revisedShortLeave} onChange={set("revisedShortLeave")} placeholder="No change" />
        </label>
        <label>Asked for by
          <Input value={form.requestedBy} onChange={set("requestedBy")} placeholder="Employee or manager name" />
        </label>
        <label>Reason (required)
          <Input.TextArea rows={3} value={form.reason} onChange={set("reason")} placeholder="System outage, approved training, disputed record…" />
        </label>
      </div>
    </FormModal>
  );
}

export function PolicyAttendance({ base, single, canCorrect, reloadKey }) {
  const [data, setData] = useState(null);
  const [fixing, setFixing] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const p = new URLSearchParams(base);
    setData((d) => (d ? { ...d, loading: true } : d));
    request.get({ entity: `workday/admin/360/policy-days?${p}` }).then((r) => live && setData(r?.success ? r.result : { rows: [], count: 0 }));
    return () => {
      live = false;
    };
  }, [base, tick, reloadKey]);
  const rows = data?.rows || [];
  const fullDialer = hm(data?.rules?.dialer?.fullMin || 465);
  const count = (k) => rows.filter((r) => (r.policy?.preview ? LEVEL_TO_STATUS[r.policy.level] : r.status) === k).length;
  const shortTotal = rows.reduce((t, r) => t + (r.shortLeave || 0), 0);
  const route = (key, r) => r.policy?.routes.find((x) => x.key === key);
  const exportRows = () => {
    const cols = [["dayKey", "Date"], ["name", "User"], ["result", "Result"], ["dialer", "Dialer (min)"], ["attempts", "Call attempts"], ["talk", "Talk (min)"], ["prospects", "Verified prospects"], ["demos", "Attended demos"], ["shortLeave", "Short-leave events"], ["why", "Why"]].map(([key, label]) => ({ key, label }));
    const out = rows.map((r) => ({ ...r, result: (RESULT[r.status] || [r.status])[0], dialer: r.policy?.metrics.dialerMin, attempts: r.policy?.metrics.attempts, talk: Math.floor((r.policy?.metrics.talkSec || 0) / 60), prospects: r.policy?.metrics.verifiedProspects, demos: r.policy?.metrics.attendedDemos, why: (r.policy?.shortLeave || []).map((x) => x.label).join("; ") }));
    downloadCsv("policy-attendance.csv", rowsToCsv(out, cols));
  };
  return (
    <Panel
      title={`Attendance by policy · ${n(data?.count)} day${data?.count === 1 ? "" : "s"}`}
      icon={<AuditOutlined />}
      extra={<button type="button" className="hub-btn" onClick={exportRows}><DownloadOutlined /> CSV</button>}
    >
      <div className="s3p-counts">
        {[["Full day", count("present")], ["Half day", count("half-day")], ["Absent", count("absent")], ["In progress", count("in-progress")], ["Short leave", shortTotal]].map(([label, c]) => <span key={label}>{label} <b>{n(c)}</b></span>)}
      </div>
      <div className={`hub-table-wrapper ${data?.loading ? "is-loading" : ""}`}>
        <table className="hub-table s3-table">
          <thead>
            <tr>
              <th>Date</th>
              {!single && <th>User</th>}
              <th>Result</th>
              <th title={`${fullDialer} = full, 4h = half at most, under 4h = absent. Breaks and leave don't count.`}>Dialer</th>
              <th title="150 = full, 100 = half. Each number once a day.">Call attempts</th>
              <th title="3h = full, 2h = half">Talk</th>
              <th title="3 = full, 1 = half. Verified by a Team Leader.">Verified prospects</th>
              <th title="3 = full, 1 = half. The candidate joined the demo.">Attended demos</th>
              <th>Short leave</th>
              {canCorrect && <th />}
            </tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={10}><div className="s3-skel-rows"><i /><i /></div></td></tr>}
            {data && !rows.length && <tr><td colSpan={10}><div className="s3-empty">No day matches these filters. The policy can be checked from 23 Oct 2026, when the dialer log starts.</div></td></tr>}
            {rows.map((r) => {
              const st = RESULT[r.status] || [r.status, "#64748B"];
              const m = r.policy?.metrics;
              const cell = (key, text) => {
                const x = route(key, r);
                return <td style={{ color: x ? LEVEL_COLOR[x.level] : undefined, fontWeight: x && x.level !== "absent" ? 700 : 500 }}>{text}</td>;
              };
              return (
                <tr key={`${r.adminId}-${r.dayKey}`}>
                  <td style={{ whiteSpace: "nowrap" }}><b>{dayjs(r.dayKey).format("D MMM")}</b> <span className="s3-muted">{dayjs(r.dayKey).format("ddd")}</span>{r.dayType === "recovery" && <div className="s3-muted">Recovery Sunday</div>}</td>
                  {!single && <td><b>{r.name}</b><div className="s3-muted">{r.role}{r.team ? ` · ${r.team}` : ""}</div></td>}
                  <td>
                    <Pill color={st[1]}>{st[0]}</Pill>
                    {r.policy?.preview && <div className="s3-muted">Policy would say: {(RESULT[LEVEL_TO_STATUS[r.policy.level]] || [])[0]}</div>}
                    {r.policy && r.policy.routeLevel !== r.policy.level && <div className="s3-muted">Capped by dialer hours</div>}
                    {r.correction && <div className="s3-muted" title={r.correction.reason}>Corrected by {r.correction.by}, was {(RESULT[r.correction.originalStatus] || [r.correction.originalStatus])[0]}</div>}
                  </td>
                  <td style={{ color: m ? LEVEL_COLOR[r.policy.cap] : undefined, fontWeight: 700 }}>
                    {m ? hm(m.dialerMin) : "—"}
                    {m?.lostMin > 0 && <div className="s3-muted">CRM closed {hm(m.lostMin)}</div>}
                    {m?.creditMin > 0 && <div className="s3-muted">{hm(m.creditMin)} credited</div>}
                    {r.policy?.outages?.map((o, i) => <div key={i} className="s3-muted" title={o.reason}>{o.kind} logged</div>)}
                  </td>
                  {cell("attempts", m ? n(m.attempts) : "—")}
                  {cell("talkMin", m ? hm(Math.floor(m.talkSec / 60)) : "—")}
                  {cell("verifiedProspects", m ? m.verifiedProspects : "—")}
                  {cell("attendedDemos", m ? m.attendedDemos : "—")}
                  <td>
                    {r.shortLeave ? <span className="s3-warn">{r.shortLeave}</span> : "—"}
                    {(r.policy?.shortLeave || []).map((x) => <div key={x.kind} className="s3-muted">{x.label}</div>)}
                    {r.policy?.breakGrace && <div className="s3-muted">Break overrun: weekly grace used</div>}
                  </td>
                  {canCorrect && <td><button type="button" className="s3-link" onClick={() => setFixing(r)}>Correct</button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="s3-note">The best of prospects, demos, attempts or talk decides the day, then the dialer caps it: {fullDialer} or more allows a full day, 4h up to that allows a half day at most, under 4h is absent. Green = full level, teal = half level. Two short-leave events can be consolidated into one half-day by a manager; nothing is deducted automatically.{data?.effectiveFrom ? ` Days before ${dayjs(data.effectiveFrom).format("D MMM YYYY")} keep their old status and only preview the policy.` : ""}</p>
      <CorrectModal row={fixing} onClose={() => setFixing(null)} onSaved={() => { setFixing(null); setTick((x) => x + 1); }} />
    </Panel>
  );
}

// ── every lead stage ─────────────────────────────────────────────────────
export function StageExplorer({ tree: allStages, rows, one, only, onlySub, renderList, onPickUser }) {
  const [clicked, setClicked] = useState(null);
  // A stage picked in the filter bar: just that one, with its leads open.
  const tree = only ? (allStages || []).filter((s) => s.stage === only) : allStages;
  const stage = only || clicked;
  const setStage = (s) => !only && setClicked(s);
  const total = (tree || []).reduce((t, x) => t + x.n, 0);
  const picked = (tree || []).find((x) => x.stage === stage);
  return (
    <Panel title={`${only || "All lead stages"} · ${n(total)} leads moved`} icon={<AimOutlined />} extra={only ? null : <span className="s3-muted">click a stage for every lead</span>}>
      <div className="s3p-stages">
        {(tree || []).map((s) => (
          <button key={s.stage} type="button" className={stage === s.stage ? "on" : ""} style={{ "--c": s.color }} onClick={() => setStage(stage === s.stage ? null : s.stage)} aria-pressed={stage === s.stage}>
            <span>{s.stage}</span>
            <b>{n(s.n)}</b>
            <small>{s.subs.length} sub-status{s.subs.length === 1 ? "" : "es"}</small>
          </button>
        ))}
      </div>
      {picked && (
        <div className="s3p-subs">
          {picked.subs.filter((x) => !onlySub || x.key === onlySub).map((x) => <span key={x.key}><i style={{ background: picked.color }} />{x.key} <b>{n(x.n)}</b></span>)}
        </div>
      )}
      {stage && renderList(stage)}
      {!one && !stage && rows?.length > 0 && (
        <div className="hub-table-wrapper" style={{ marginTop: 14 }}>
          <table className="hub-table s3-table">
            <thead>
              <tr><th>User</th>{(tree || []).map((s) => <th key={s.stage} style={{ whiteSpace: "normal", minWidth: 74 }}>{s.stage}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.adminId} className="s3-click" onClick={() => onPickUser(r.adminId)}>
                  <td><b>{r.name}</b></td>
                  {(tree || []).map((s) => <td key={s.stage}>{r.stages?.[s.stage] ? <b>{n(r.stages[s.stage])}</b> : <span className="s3-muted">0</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ── prospect verification ────────────────────────────────────────────────
function DecideModal({ row, status, meId, canExcuse, onClose, onSaved }) {
  const [notes, setNotes] = useState("");
  const [checks, setChecks] = useState({ genuine: false, suitable: false, interested: false });
  const [exception, setException] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setNotes("");
    setChecks({ genuine: false, suitable: false, interested: false });
    setException("");
  }, [row]);
  if (!row) return null;
  const myCall = (row.talked || []).find((p) => p.agent === String(meId));
  const verifying = status === "verified";
  const noCall = verifying && !(myCall && myCall.connected);
  const needsExcuse = verifying && (noCall || row.missing.length > 0);
  const why =
    notes.trim().length < 5
      ? "Write the outcome of your call"
      : verifying && !(checks.genuine && checks.suitable && checks.interested)
      ? "Confirm all three checks"
      : needsExcuse && !canExcuse
      ? noCall
        ? "Call the candidate first"
        : "Fill the missing details first"
      : needsExcuse && exception.trim().length < 5
      ? "Write the reason for the exception"
      : "";
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: `workday/admin/360/prospects/${row._id}/decide`, jsonData: { status, notes, checks, exception } });
    setBusy(false);
    if (r?.success) onSaved();
  };
  return (
    <FormModal title={`${status === "verified" ? "Verify" : "Reject"} ${row.name}`} subtitle={`Raised by ${row.owner} · ${row.phone}`} okText={status === "verified" ? "Mark verified" : "Mark rejected"} busy={busy} why={why} onOk={save} onClose={onClose}>
      <p className="s3-note" style={{ marginTop: 0 }}>{(() => {
        const mine = (row.talked || []).find((p) => p.agent === String(meId));
        return mine && mine.connected ? `You have spoken to them: ${talkText(mine.talkSec)}. Record what came out of it.` : "You have not spoken to them yet. Call the candidate yourself first, then record what came out of it.";
      })()}</p>
      <div className="s3p-form">
        <label>Outcome of your call (required)
          <Input.TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Genuine, suitable, positively interested…" />
        </label>
        {verifying && (
          <div className="s3p-ticks">
            {[["genuine", "Genuine candidate"], ["suitable", "Suitable for the program"], ["interested", "Positively interested"]].map(([k, label]) => (
              <label key={k}><input type="checkbox" checked={checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} /> {label}</label>
            ))}
          </div>
        )}
        {verifying && row.missing.length > 0 && <div className="s3p-check"><span><b>Missing details:</b> {row.missing.join(", ")}. Fill them from the call popup.</span></div>}
        {needsExcuse && canExcuse && (
          <label>Exception reason (Sales Manager only)
            <Input.TextArea rows={2} value={exception} onChange={(e) => setException(e.target.value)} placeholder="Why this is verified without the call or the details" />
          </label>
        )}
      </div>
    </FormModal>
  );
}

const PROSPECT_STATE = { waiting: ["Waiting", "#B45309"], verified: ["Verified", "#15803D"], rejected: ["Rejected", "#B91C1C"] };

export function ProspectQueue({ base, canVerify, onChanged }) {
  const me = useSelector(selectCurrentAdmin);
  const [dialing, setDialing] = useState(null);
  const [rows, setRows] = useState(null);
  const [tick, setTick] = useState(0);
  const [deciding, setDeciding] = useState(null);
  const [view, setView] = useState(null);
  useEffect(() => {
    let live = true;
    request.get({ entity: `workday/admin/360/prospects?${new URLSearchParams(base)}` }).then((r) => live && setRows(r?.success ? r.result : []));
    return () => {
      live = false;
    };
  }, [base, tick]);
  // Who has talked changes while a call goes on.
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 20000);
    return () => clearInterval(id);
  }, []);
  const stop = (e) => e.stopPropagation();
  // The same manual dial as My Calls; the in-call popup opens once it connects.
  const call = async (r) => {
    setDialing(r._id);
    const x = await request.post({ entity: "calling/manual/dial", jsonData: { phone: String(r.phone || "").replace(/[^\d+]/g, ""), contactName: r.name } });
    setDialing(null);
    if (!x?.success) message.error(x?.message || "Could not place the call.");
  };
  return (
    <Panel title={`Prospect verification${rows ? ` · ${n(rows.length)}` : ""}`} icon={<TrophyOutlined />}>
      <div className="hub-table-wrapper">
        <table className="hub-table s3-table">
          <thead>
            <tr><th>Lead</th><th>Status</th><th>Raised by</th><th>Raised / reviewed</th><th>Sent to</th><th>Who talked</th><th>Missing details / outcome</th>{canVerify && <th />}</tr>
          </thead>
          <tbody>
            {!rows && <tr><td colSpan={8}><div className="s3-skel-rows"><i /><i /></div></td></tr>}
            {rows && !rows.length && <tr><td colSpan={8}><div className="s3-empty">No prospect matches these filters.</div></td></tr>}
            {(rows || []).map((r) => (
              <tr key={r._id} className="s3-click" title="Click for full details" onClick={() => setView({ phone: r.phone, name: r.name })}>
                <td><b>{r.name}</b><div className="s3-muted">{r.phone}</div></td>
                <td><Pill color={PROSPECT_STATE[r.verification?.status || "waiting"][1]}>{PROSPECT_STATE[r.verification?.status || "waiting"][0]}</Pill></td>
                <td>{r.owner}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.verification ? when(r.verification.at) : when(r.raisedAt)}</td>
                <td style={{ maxWidth: 220 }}>
                  {r.handoffs.length ? r.handoffs.map((h) => <div key={`${h.to}`}>{h.toName}<span className="s3-muted"> · {when(h.at)}</span>{h.note && <div className="s3-muted">{h.note}</div>}</div>) : <span className="s3-muted">Not sent</span>}
                </td>
                <td style={{ minWidth: 190 }}>
                  {(r.talked || []).map((p) => <div key={p.agent}><b>{p.name}</b><div className={p.connected ? "t-up" : "s3-muted"}>{talkLine(p)}</div></div>)}
                </td>
                <td style={{ maxWidth: 340 }}>
                  {!r.verification ? (r.missing.length ? <span className="s3-warn">{r.missing.join(", ")}</span> : <span className="t-up">All filled</span>) : (
                    <>
                      {r.verification?.notes}
                      <div className="s3-muted">{r.verification?.byName}{r.verification?.callFound ? " · call on record" : " · no CRM call found in the last 7 days"}</div>
                    </>
                  )}
                </td>
                {canVerify && (
                  <td style={{ whiteSpace: "nowrap" }} onClick={stop}>
                    {!r.verification && (
                      <>
                        <button type="button" className="s3-link" disabled={!!dialing} onClick={() => call(r)}>{dialing === r._id ? "Calling…" : "Call"}</button>
                        {" · "}
                        <button type="button" className="s3-link" onClick={() => setDeciding({ row: r, status: "verified" })}>Verify</button>
                        {" · "}
                        <button type="button" className="s3-link" style={{ color: "#B91C1C" }} onClick={() => setDeciding({ row: r, status: "rejected" })}>Reject</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="s3-note">A prospect counts for attendance and targets only after a Team Leader's own verification call. Nobody can verify a prospect they raised. Click a row for every call, note and recording; the person who sent it sees the same.</p>
      <DecideModal row={deciding?.row} status={deciding?.status} meId={me?._id} canExcuse={["owner", "Super Admin", "Admin", "Sales Manager"].includes(me?.role)} onClose={() => setDeciding(null)} onSaved={() => { setDeciding(null); setTick((x) => x + 1); onChanged(); }} />
      <LeadFullDetailModal lead={view} onClose={() => setView(null)} />
    </Panel>
  );
}

// ── targets, backlog, recovery Sunday, overdue, leave ────────────────────
function RosterModal({ row, sunday, onClose, onSaved }) {
  const [form, setForm] = useState({ sundayKey: sunday, restDayKey: "", plan: "", compensation: "", hrChecked: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm({ sundayKey: sunday, restDayKey: "", plan: "", compensation: "", hrChecked: false }), [row, sunday]);
  if (!row) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: "workday/admin/360/roster", jsonData: { adminId: row.adminId, ...form } });
    setBusy(false);
    if (r?.success) onSaved();
  };
  return (
    <FormModal title={`Recovery Sunday · ${row.name}`} okText="Schedule and notify" busy={busy} why={!form.sundayKey || !form.restDayKey ? "Pick both dates" : form.plan.trim().length < 5 ? "Write the work plan" : form.compensation.trim().length < 3 ? "Write the compensation" : !form.hrChecked ? "HR must confirm first" : ""} onOk={save} onClose={onClose}>
      <p className="s3-note" style={{ marginTop: 0 }}>{row.by20} of {row.targetProspects} verified prospects by the 20th. HR must check state law and overtime or other compensation before this is rostered.</p>
      <div className="s3p-form">
        <label>Sunday
          <Input type="date" value={form.sundayKey} onChange={set("sundayKey")} />
        </label>
        <label>Substitute rest day (within 7 days)
          <Input type="date" value={form.restDayKey} onChange={set("restDayKey")} />
        </label>
        <label>Work plan
          <Input.TextArea rows={3} value={form.plan} onChange={set("plan")} placeholder="Backlog clearance, pending follow-ups, counselling, demos…" />
        </label>
        <label>Overtime or other compensation
          <Input value={form.compensation} onChange={set("compensation")} placeholder="Overtime pay, comp off…" />
        </label>
        <label className="s3p-check">
          <input type="checkbox" checked={form.hrChecked} onChange={(e) => setForm((f) => ({ ...f, hrChecked: e.target.checked }))} />
          <span>HR has checked state law and any exemption for this Sunday.</span>
        </label>
      </div>
    </FormModal>
  );
}
function WaiveModal({ row, month, onClose, onSaved }) {
  const [form, setForm] = useState({ waived: "", reason: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm({ waived: row?.backlogWaived || "", reason: row?.backlogWaivedReason || "" }), [row]);
  if (!row) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: "workday/admin/360/backlog-waive", jsonData: { adminId: row.adminId, period: month, ...form } });
    setBusy(false);
    if (r?.success) onSaved();
  };
  return (
    <FormModal title={`Waive backlog · ${row.name}`} okText="Save waiver" busy={busy} why={form.waived === "" ? "Enter how many are waived" : String(form.reason).trim().length < 5 ? "Write the reason" : ""} onOk={save} onClose={onClose}>
      <p className="s3-note" style={{ marginTop: 0 }}>Backlog now: {row.backlog} prospects. Recorded against {dayjs(`${month}-01`).format("MMMM YYYY")}.</p>
      <div className="s3p-form">
        <label>Prospects waived
          <Input type="number" min={0} value={form.waived} onChange={set("waived")} />
        </label>
        <label>Reason (required)
          <Input.TextArea rows={3} value={form.reason} onChange={set("reason")} />
        </label>
      </div>
    </FormModal>
  );
}

// One row of the board, opened: what each of its numbers is made of.
function Rows({ title, count, empty, head, children }) {
  return (
    <div className="s3t-part">
      <h5>{title} <span>{count}</span></h5>
      {count ? (
        <div className="hub-table-wrapper">
          <table className="hub-table s3-table">
            <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      ) : <div className="s3-muted">{empty}</div>}
    </div>
  );
}
function TargetDetail({ row, month, onClose }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    request.get({ entity: `workday/admin/360/target-detail?${new URLSearchParams({ adminId: row.adminId, month })}` }).then((r) => {
      if (!live) return;
      if (r?.success) setData(r.result);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [row.adminId, month]);
  const lead = (l) => ({ className: "s3-click", title: "Click for full lead details", onClick: () => setView({ phone: l.phone, name: l.name }) });
  const leaveKind = (l) => [l.durationType === "hours" && l.hours ? `${l.hours}h` : null, l.emergency ? "emergency" : null, l.lateNotice ? "under 24h notice" : null].filter(Boolean).join(" · ");
  const stats = [
    ["Prospect target", row.targetProspects ?? "Not set"],
    ["Verified", row.achieved],
    ["By the 20th", row.by20],
    ["Backlog", row.backlog],
    ["Overdue now", row.overdue],
    ["Overdue today", row.overdueToday],
    ["Approved leave", `${row.leaveDays || 0} d`],
  ];
  return (
    <HubModal open onClose={onClose} title={row.name} subtitle={`${row.role}${row.team ? ` · ${row.team}` : ""} · ${dayjs(`${month}-01`).format("MMMM YYYY")}`} width={1040}>
      <div className="s3t-stats">
        {stats.map(([k, v]) => <div key={k}><b>{v}</b><span>{k}</span></div>)}
      </div>
      {!data && !failed && <div className="s3-skel-rows"><i /><i /><i /></div>}
      {failed && <div className="s3-empty">Could not load the details. Please try again.</div>}
      {data && (
        <>
          <div className="s3t-part">
            <h5>Target &amp; backlog</h5>
            <p className="s3-muted">{data.target?.setByName ? `Last set by ${data.target.setByName}, ${when(data.target.updated)}.` : "No target set for this month yet."}</p>
            {data.target?.history?.map((h, i) => <div key={i} className="s3-muted">{when(h.at)}: {h.from ?? "Not set"} to {h.to ?? "Not set"} by {h.byName || "—"}{h.reason ? `, "${h.reason}"` : ""}</div>)}
            {row.backlogMonths?.map((b) => <div key={b.period}>{dayjs(`${b.period}-01`).format("MMM YYYY")}: target {b.target ?? "not set"}, verified {b.achieved}{b.waived ? `, ${b.waived} waived` : ""}</div>)}
            {row.backlogWaived > 0 && <div>Waived this month: {row.backlogWaived}{row.backlogWaivedReason ? `, "${row.backlogWaivedReason}"` : ""}</div>}
            <p style={{ marginBottom: 0 }}>
              {row.roster ? <>Recovery Sunday <b>{dayjs(row.roster.sundayKey).format("D MMM")}</b>, rest day {dayjs(row.roster.restDayKey).format("D MMM")}, set by {row.roster.by || "—"}. Plan: {row.roster.plan}</> : row.recoveryDue ? <span className="s3-warn">Target missed by the 20th: recovery Sunday not scheduled yet.</span> : "No recovery Sunday this month."}
            </p>
          </div>
          <Rows title="Prospects reviewed this month" count={data.reviewed.length} empty="No prospect was verified or rejected this month." head={["Lead", "Result", "Reviewed by", "When", "By the 20th", "Notes"]}>
            {data.reviewed.map((l) => (
              <tr key={l._id} {...lead(l)}>
                <td><b>{l.name || "—"}</b><div className="s3-muted">{l.phone}{l.source ? ` · ${l.source}` : ""}</div></td>
                <td><Pill color={l.status === "verified" ? "#15803D" : "#B91C1C"}>{l.status === "verified" ? "Verified" : "Rejected"}</Pill></td>
                <td>{l.by || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{when(l.at)}</td>
                <td>{l.by20 ? "Yes" : "No"}</td>
                <td className="s3-muted">{l.notes || "—"}</td>
              </tr>
            ))}
          </Rows>
          <Rows title="Prospects waiting for review" count={data.waiting.length} empty="Nothing is waiting for review." head={["Lead", "Raised", "Sent to"]}>
            {data.waiting.map((l) => (
              <tr key={l._id} {...lead(l)}>
                <td><b>{l.name || "—"}</b><div className="s3-muted">{l.phone}{l.source ? ` · ${l.source}` : ""}</div></td>
                <td style={{ whiteSpace: "nowrap" }}>{when(l.raisedAt)}</td>
                <td className="s3-muted">{l.sentTo.join(", ") || "Not sent yet"}</td>
              </tr>
            ))}
          </Rows>
          <Rows title="Overdue now" count={data.overdue.length} empty="Nothing is overdue." head={["Lead", "Task", "Was due", "Review"]}>
            {data.overdue.map((l) => (
              <tr key={l._id} {...lead(l)}>
                <td><b>{l.name || "—"}</b><div className="s3-muted">{l.phone}</div></td>
                <td>{l.stage === "Callback" ? "Callback" : l.stage === "Demo Booking" ? "Demo" : "Follow-up"}</td>
                <td style={{ whiteSpace: "nowrap" }}>{when(l.due)}</td>
                <td className="s3-muted">{[l.status, l.explanation, l.reviewNote].filter(Boolean).join(" · ") || "—"}</td>
              </tr>
            ))}
          </Rows>
          <Rows title="Approved leave" count={data.leaves.length} empty="No approved leave this month." head={["From", "To", "Type", "Days", "Reason", "Approved by"]}>
            {data.leaves.map((l) => (
              <tr key={l._id}>
                <td style={{ whiteSpace: "nowrap" }}>{when(l.fromDate)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{when(l.toDate)}</td>
                <td>{l.leaveType}{leaveKind(l) ? <div className="s3-muted">{leaveKind(l)}</div> : null}</td>
                <td>{l.days ?? "—"}</td>
                <td className="s3-muted">{l.reason || "—"}</td>
                <td className="s3-muted">{l.decisionBy || l.approver || "—"}</td>
              </tr>
            ))}
          </Rows>
        </>
      )}
      <LeadFullDetailModal lead={view} onClose={() => setView(null)} />
    </HubModal>
  );
}

export function TargetsBoard({ base, canManage, canSetTargets }) {
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const show = base.target || "";
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState({});
  const [rostering, setRostering] = useState(null);
  const [waiving, setWaiving] = useState(null);
  const [opened, setOpened] = useState(null); // row clicked → everything behind it
  const { adminId, team, role } = base;
  useEffect(() => {
    let live = true;
    const p = new URLSearchParams({ month });
    if (adminId) p.set("adminId", adminId);
    if (team) p.set("team", team);
    if (role) p.set("role", role);
    request.get({ entity: `workday/admin/360/targets?${p}` }).then((r) => {
      if (!live) return;
      setData(r?.success ? r.result : { rows: [] });
      setDraft({});
    });
    return () => {
      live = false;
    };
  }, [adminId, team, role, month, tick]);
  const [changing, setChanging] = useState(null); // a target already set: why it changes
  const [changeWhy, setChangeWhy] = useState("");
  const sendTarget = async (r, reason) => {
    const v = draft[r.adminId];
    const res = await request.post({ entity: "performance/targets", jsonData: { admin: r.adminId, period: month, targetProspects: v === "" ? null : Number(v), targetProspectsReason: reason } });
    if (res?.success) {
      setChanging(null);
      setTick((x) => x + 1);
    } else message.error(res?.message || "Could not save the target.");
  };
  const saveTarget = (r) => {
    const v = draft[r.adminId];
    if (v === undefined || String(v) === String(r.targetProspects ?? "")) return;
    if (r.targetProspects != null) {
      setChangeWhy("");
      setChanging(r);
    } else sendTarget(r, "");
  };
  const cancelRoster = async (r) => {
    const x = await request.post({ entity: "workday/admin/360/roster/cancel", jsonData: { adminId: r.adminId, sundayKey: r.roster.sundayKey } });
    if (x?.success) setTick((t) => t + 1);
  };
  const rows = (data?.rows || []).filter((r) => (show === "behind" ? r.targetProspects && r.achieved < r.targetProspects : show === "recovery" ? r.recoveryDue || r.roster : show === "backlog" ? r.backlog > 0 : show === "overdue" ? r.overdue >= 2 : true));
  // Section 10 counts one day's misses: older ones are shown, but lead to nothing here.
  const overdueNote = (r) => (!r.overdue ? "" : !r.overdueToday ? "from earlier days" : `${r.overdueToday} today: ${r.overdueToday >= 4 ? "2 short-leave events after review" : r.overdueToday >= 2 ? "1 short-leave event after review" : "reminder"}`);
  return (
    <Panel
      title="Targets, backlog & recovery Sunday"
      icon={<FormOutlined />}
      extra={
        <div className="s3-att-nav">
          <button type="button" onClick={() => setMonth((m) => dayjs(`${m}-01`).subtract(1, "month").format("YYYY-MM"))} aria-label="Previous month"><LeftOutlined /></button>
          <b>{dayjs(`${month}-01`).format("MMMM YYYY")}</b>
          <button type="button" onClick={() => setMonth((m) => dayjs(`${m}-01`).add(1, "month").format("YYYY-MM"))} aria-label="Next month"><RightOutlined /></button>
        </div>
      }
    >
      <div className="hub-table-wrapper">
        <table className="hub-table s3-table">
          <thead>
            <tr><th>User</th><th>Prospect target</th><th>Verified</th><th>By the 20th</th><th>Backlog</th><th>Recovery Sunday{data?.lastSunday ? ` · ${dayjs(data.lastSunday).format("D MMM")}` : ""}</th><th>Overdue now</th><th>Approved leave</th></tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={8}><div className="s3-skel-rows"><i /><i /></div></td></tr>}
            {data && !rows.length && <tr><td colSpan={8}><div className="s3-empty">Nobody matches this filter.</div></td></tr>}
            {rows.map((r) => (
              <tr key={r.adminId} className="s3-click" tabIndex={0} title="Click for full details" onClick={() => setOpened(r)} onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && setOpened(r)}>
                <td style={{ whiteSpace: "nowrap" }}><b>{r.name}</b><div className="s3-muted">{r.role}{r.team ? ` · ${r.team}` : ""}</div></td>
                <td onClick={(e) => e.stopPropagation()}>
                  {canSetTargets ? (
                    <Input className="s3p-num" type="number" min={0} aria-label={`Prospect target for ${r.name}`} value={draft[r.adminId] ?? r.targetProspects ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [r.adminId]: e.target.value }))} onBlur={() => saveTarget(r)} onPressEnter={(e) => e.target.blur()} placeholder="Not set" />
                  ) : r.targetProspects ?? <span className="s3-muted">Not set</span>}
                </td>
                <td><b>{n(r.achieved)}</b>{r.targetProspects ? <span className="s3-muted"> / {r.targetProspects}</span> : null}</td>
                <td>{n(r.by20)}</td>
                <td>
                  {r.backlog ? <span className="s3-warn">{r.backlog}</span> : 0}
                  {r.backlogWaived ? <div className="s3-muted" title={r.backlogWaivedReason || ""}>{r.backlogWaived} waived</div> : null}
                  {canManage && r.backlog > 0 && <div><button type="button" className="s3-link" onClick={(e) => { e.stopPropagation(); setWaiving(r); }}>Waive</button></div>}
                </td>
                <td style={{ maxWidth: 260 }}>
                  {r.roster ? (
                    <>
                      <b>Scheduled</b> · rest day {dayjs(r.roster.restDayKey).format("D MMM")}
                      <div className="s3-muted">{r.roster.plan}</div>
                      {canManage && <button type="button" className="s3-link" onClick={(e) => { e.stopPropagation(); cancelRoster(r); }}>Cancel</button>}
                    </>
                  ) : r.recoveryDue ? (
                    <>
                      <span className="s3-warn">Target missed by the 20th</span>
                      {canManage && <div><button type="button" className="s3-link" onClick={(e) => { e.stopPropagation(); setRostering(r); }}>Schedule</button></div>}
                    </>
                  ) : <span className="s3-muted">Normal Sunday off</span>}
                </td>
                <td>{r.overdue ? <span className={r.overdue >= 2 ? "s3-warn" : ""}>{r.overdue}</span> : 0}<div className="s3-muted">{overdueNote(r)}</div></td>
                <td>
                  {r.leaveDays || 0} day{r.leaveDays === 1 ? "" : "s"}
                  <div className="s3-muted">{r.paidLeave || 0} of 1 paid{r.statutoryLeave ? ` · ${r.statutoryLeave} statutory` : ""}</div>
                  {r.overPaid > 0 && <div className="s3-warn">{r.overPaid} over the paid day</div>}
                  {r.lateNoticeLeaves > 0 && <div className="s3-muted">{r.lateNoticeLeaves} under 24h notice</div>}
                  {r.emergencyLeaves > 0 && <div className="s3-muted">{r.emergencyLeaves} emergency</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="s3-note">Click a row for everything behind its numbers. Overdue = callbacks, booked demos and future follow-ups past their time, under the assigned user, else whoever last moved the lead. Short-leave events count only one day's misses. Leave out anything outside their control before recording an event. Set the target by typing it; it saves when you click away, and the user is told. The target is measured by Team Leader verified prospects in the calendar month.</p>
      {changing && (
        <FormModal title={`Change target · ${changing.name}`} subtitle={`${changing.targetProspects} to ${draft[changing.adminId] || "not set"}`} okText="Save" why={changeWhy.trim().length < 5 ? "Write why it is changing" : ""} onOk={() => sendTarget(changing, changeWhy)} onClose={() => setChanging(null)}>
          <div className="s3p-form">
            <label>Reason
              <Input.TextArea rows={3} value={changeWhy} onChange={(e) => setChangeWhy(e.target.value)} />
            </label>
          </div>
        </FormModal>
      )}
      {opened && <TargetDetail row={opened} month={month} onClose={() => setOpened(null)} />}
      <RosterModal row={rostering} sunday={data?.lastSunday} onClose={() => setRostering(null)} onSaved={() => { setRostering(null); setTick((x) => x + 1); }} />
      <WaiveModal row={waiving} month={month} onClose={() => setWaiving(null)} onSaved={() => { setWaiving(null); setTick((x) => x + 1); }} />
    </Panel>
  );
}

// ── everything a user did ────────────────────────────────────────────────
const TYPES = [
  ["session", "Login", "#334155"],
  ["dialer", "Dialer", "#0F766E"],
  ["break", "Break", "#B45309"],
  ["leave", "Leave", "#7C3AED"],
  ["call", "Call", "#2563EB"],
  ["response", "Response", "#BE185D"],
  ["payment", "Payment", "#15803D"],
  ["screen", "Screen", "#0369A1"],
  ["click", "Click", "#475569"],
  ["search", "Search", "#4338CA"],
  ["idle", "Idle", "#C2410C"],
];
const TYPE = Object.fromEntries(TYPES.map(([k, l, c]) => [k, [l, c]]));

export function ActivityLog({ base, showUser, whoName }) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState(50);
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState(false);
  const [view, setView] = useState(null);
  useEffect(() => setPage(1), [base]);
  useEffect(() => {
    let on = true;
    const p = new URLSearchParams({ ...base, page: String(page), items: String(items) });
    setData((d) => (d ? { ...d, loading: true } : d));
    request.get({ entity: `workday/admin/360/activity?${p}` }).then((r) => {
      if (on) setData(r?.success ? { rows: r.result, counts: r.counts, paths: r.paths, count: r.pagination.count, pages: r.pagination.pages } : { rows: [], counts: {}, paths: [], count: 0, pages: 0 });
    });
    return () => {
      on = false;
    };
  }, [base, page, items, tick]);
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setTick((x) => x + 1), 15000);
    return () => clearInterval(id);
  }, [live]);
  const exportRows = () => {
    const cols = [["time", "Time"], ["user", "User"], ["typeLabel", "Type"], ["title", "What happened"], ["detail", "Detail"], ["phone", "Phone"]].map(([key, label]) => ({ key, label }));
    downloadCsv("user-activity.csv", rowsToCsv((data?.rows || []).map((r) => ({ ...r, time: when(r.at), typeLabel: (TYPE[r.type] || [r.type])[0] })), cols));
  };
  return (
    <Panel
      title={`Activity log · ${whoName} · ${n(data?.count)} events`}
      icon={<ClockCircleOutlined />}
      extra={
        <div className="s3-chips">
          <button type="button" className={live ? "on" : ""} onClick={() => setLive((x) => !x)} aria-pressed={live}>Live</button>
          <button type="button" onClick={() => setTick((x) => x + 1)} aria-label="Refresh"><ReloadOutlined /></button>
          <button type="button" onClick={exportRows}><DownloadOutlined /> CSV</button>
        </div>
      }
    >
      <div className="s3p-counts">
        {TYPES.filter(([k]) => data?.counts?.[k] != null).map(([k, label]) => <span key={k}>{label} <b>{n(data.counts[k])}</b></span>)}
      </div>
      <div className={`hub-table-wrapper ${data?.loading ? "is-loading" : ""}`}>
        <table className="hub-table s3-table">
          <thead>
            <tr><th>Time</th>{showUser && <th>User</th>}<th>Type</th><th>What happened</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={5}><div className="s3-skel-rows"><i /><i /><i /></div></td></tr>}
            {data && !data.rows.length && <tr><td colSpan={5}><div className="s3-empty">Nothing matches these filters in this range. Clicks, screens, searches and idle time start from the day the tracker goes live.</div></td></tr>}
            {(data?.rows || []).map((r) => {
              const t = TYPE[r.type] || [r.type, "#64748B"];
              return (
                <tr key={`${r.type}-${r.id}`} className={r.phone ? "s3-click" : ""} title={r.phone ? "Click for full details" : undefined} onClick={r.phone ? () => setView({ phone: r.phone, name: r.leadName }) : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>{when(r.at)}</td>
                  {showUser && <td>{r.user || "—"}</td>}
                  <td><Pill color={t[1]}>{t[0]}</Pill></td>
                  <td><b>{r.title}</b></td>
                  <td className="s3-muted" style={{ maxWidth: 320 }}>{r.detail || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="s3-pager">
        <span className="s3-muted">{data?.count ? `${(page - 1) * items + 1}–${Math.min(page * items, data.count)} of ${n(data.count)}` : ""}</span>
        <select className="hub-select" value={items} onChange={(e) => { setItems(Number(e.target.value)); setPage(1); }} aria-label="Rows per page">
          {[25, 50, 100, 200].map((x) => <option key={x} value={x}>{x} / page</option>)}
        </select>
        <button type="button" className="hub-btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><LeftOutlined /></button>
        <span className="s3-muted">{page} / {data?.pages || 1}</span>
        <button type="button" className="hub-btn" disabled={!data || page >= data.pages} onClick={() => setPage(page + 1)} aria-label="Next page"><RightOutlined /></button>
      </div>
      <LeadFullDetailModal lead={view} onClose={() => setView(null)} />
    </Panel>
  );
}
