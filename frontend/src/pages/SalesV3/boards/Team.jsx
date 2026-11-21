import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { message } from "antd";
import { useSelector } from "react-redux";
import { request } from "@/request";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { Head, Modal, Tabs, Skel, Empty, Fail, nf, hm, talk, IST } from "../ui";
import { LeadLnk, AgentLnk } from "../popups/Popups";

// v3 design — S3Team (Team & Attendance). Real data, same APIs as Sales 360°:
//   workday/admin/360/attendance?month   → the month grid + today's tiles
//   workday/admin/360/exceptions         → missed logout (this week), no login
//   workday/admin/360/policy-days        → Policy verdict (+ POST /correct)
//   calling/team-activity                → each person's leads by stage
//   workday/admin/360/prospects          → verification (+ /:id/decide)
//   workday/admin/360/targets            → monthly target (+ performance/targets,
//                                          /roster, /roster/cancel, /backlog-waive)
//   workday/admin/360/cases | overdue | corrections | outages → Compliance
const FULL_ACCESS = ["owner", "Owner", "Super Admin", "Admin", "Sales Manager", "Team Manager"];
const POLICY_ADMIN = ["owner", "Owner", "Super Admin", "Admin", "Sales Manager"];
const ATT = { present: "Full day", "half-day": "Half day", absent: "Absent", "in-progress": "In progress", leave: "Leave", auto: "Auto-started", "late-leave": "Leave (late login)", holiday: "Holiday", "weekly-off": "Weekly off", "rest-day": "Substitute rest day", upcoming: "Not started" };
const VERDICT_B = { present: "b gr", "half-day": "b or", absent: "b rd", "in-progress": "b bl", leave: "b bl", auto: "b bl", "late-leave": "b bl" };
const LEVEL_TO_STATUS = { full: "present", half: "half-day", absent: "absent" };
const CASE_TYPE = { dispute: "Dispute", review: "Performance review", conduct: "Conduct" };
const CASE_B = { dispute: "b or", review: "b bl", conduct: "b rd" };
const CASE_STATE = { open: ["Open", "b or"], accepted: ["Accepted", "b gr"], rejected: ["Rejected", "b rd"], closed: ["Closed", "b gy"] };
const TASK_STATE = { open: ["Open", "b or"], explained: ["Reason given", "b bl"], excluded: ["Excluded", "b gy"], recorded: ["Short leave recorded", "b rd"] };
const TASK_KIND = { callback: "Callback", demo: "Demo", followup: "Follow-up" };
const OUTAGE_KIND = { outage: "Technical outage", training: "Approved training", meeting: "Official meeting", emergency: "Emergency" };
const STACK_C = ["#0F766E", "#94A3B8", "#2563EB", "#5EC4B6", "#1E293B", "#EA580C", "#7C3AED", "#0EA5E9", "#CBD5E1", "#F59E0B", "#B42318", "#16A34A"];
const BLANK = { adminId: "", month: dayjs().format("YYYY-MM"), attendance: "", late: "", short: "", dayType: "" };
const clock = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { ...IST, hour: "numeric", minute: "2-digit" }) : "—");
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { ...IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const hhmm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
const monday = () => (dayjs().day() === 0 ? dayjs().subtract(6, "day") : dayjs().startOf("week").add(1, "day")).startOf("day");
const todayKey = () => new Date().toLocaleDateString("en-CA", IST);
const months = () => Array.from({ length: 12 }, (_, i) => dayjs().subtract(i, "month"));

function useGet(entity, deps) {
  const [s, setS] = useState({ data: null, loading: true, error: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!entity) return undefined;
    let live = true;
    setS((x) => ({ ...x, loading: true, error: false }));
    request.get({ entity }).then((r) => {
      if (!live) return;
      setS(r?.success ? { data: r.result, loading: false, error: false } : { data: null, loading: false, error: true });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, tick, ...(deps || [])]);
  return { ...s, reload: () => setTick((x) => x + 1) };
}

// One-text popup (decision, reason, note) → POST
function TextAction({ action, onClose, onSaved }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  if (!action) return null;
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: action.entity, jsonData: { ...action.body, [action.field]: v } });
    setBusy(false);
    if (r?.success) {
      message.success(r.message || "Saved.");
      onSaved();
    } else message.error(r?.message || "Could not save.");
  };
  const short = v.trim().length < 5;
  return (
    <Modal title={action.title} sub={action.sub} onClose={onClose} width={520} footer={<><button type="button" className="btn g" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={busy || short} title={short ? `Write the ${action.label.toLowerCase()}` : undefined} onClick={save}>{busy ? "Saving…" : action.ok}</button></>}>
      <label className="fld">{action.label}<textarea className="in" rows={4} value={v} onChange={(e) => setV(e.target.value)} /></label>
    </Modal>
  );
}

function CorrectModal({ row, onClose, onSaved }) {
  const [f, setF] = useState({ revisedStatus: "", revisedShortLeave: "", reason: "", requestedBy: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const why = f.reason.trim().length < 5 ? "Write the reason" : !f.revisedStatus && f.revisedShortLeave === "" ? "Change the status or short leave" : "";
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: "workday/admin/360/correct", jsonData: { adminId: row.adminId, dayKey: row.dayKey, ...f } });
    setBusy(false);
    if (r?.success) {
      message.success(r.message || "Correction saved.");
      onSaved();
    } else message.error(r?.message || "Could not save the correction.");
  };
  return (
    <Modal title={`Correct ${row.name}`} sub={dayjs(row.dayKey).format("D MMM YYYY")} onClose={onClose} width={560} footer={<>{why && <span className="mut" style={{ fontSize: 12.5, marginRight: "auto" }}>{why}</span>}<button type="button" className="btn g" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={busy || !!why} onClick={save}>{busy ? "Saving…" : "Save correction"}</button></>}>
      <p className="mut" style={{ marginTop: 0 }}>Right now: <b style={{ color: "#0F1E2B" }}>{ATT[row.status] || row.status}</b>, {row.shortLeave || 0} short-leave event{row.shortLeave === 1 ? "" : "s"}. The original entry, your name and the time are kept.</p>
      <div className="fgrid">
        <label className="fld">New day status
          <select className="sel" value={f.revisedStatus} onChange={set("revisedStatus")}>
            <option value="">No change</option><option value="present">Full day</option><option value="half-day">Half day</option><option value="absent">Absent</option><option value="leave">Leave</option>
          </select>
        </label>
        <label className="fld">Short-leave events<input className="in" type="number" min={0} max={4} placeholder="No change" value={f.revisedShortLeave} onChange={set("revisedShortLeave")} /></label>
        <label className="fld">Asked for by<input className="in" placeholder="Employee or manager name" value={f.requestedBy} onChange={set("requestedBy")} /></label>
      </div>
      <label className="fld" style={{ marginTop: 10 }}>Reason (required)<textarea className="in" rows={3} placeholder="System outage, approved training, disputed record…" value={f.reason} onChange={set("reason")} /></label>
    </Modal>
  );
}

function DecideModal({ row, status, meId, canExcuse, onClose, onSaved }) {
  const [notes, setNotes] = useState("");
  const [checks, setChecks] = useState({ genuine: false, suitable: false, interested: false });
  const [exception, setException] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = (row.talked || []).find((p) => p.agent === String(meId));
  const verifying = status === "verified";
  const noCall = verifying && !(mine && mine.connected);
  const missing = row.missing || [];
  const needsExcuse = verifying && (noCall || missing.length > 0);
  const why = notes.trim().length < 5 ? "Write the outcome of your call" : verifying && !(checks.genuine && checks.suitable && checks.interested) ? "Confirm all three checks" : needsExcuse && !canExcuse ? (noCall ? "Call the candidate first" : "Fill the missing details first") : needsExcuse && exception.trim().length < 5 ? "Write the reason for the exception" : "";
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: `workday/admin/360/prospects/${row._id}/decide`, jsonData: { status, notes, checks, exception } });
    setBusy(false);
    if (r?.success) {
      message.success(r.message || "Saved.");
      onSaved();
    } else message.error(r?.message || "Could not save.");
  };
  return (
    <Modal title={`${verifying ? "Verify" : "Reject"} ${row.name}`} sub={`Raised by ${row.owner || "—"} · ${row.phone || ""}`} onClose={onClose} width={560} footer={<>{why && <span className="mut" style={{ fontSize: 12.5, marginRight: "auto" }}>{why}</span>}<button type="button" className="btn g" onClick={onClose}>Cancel</button><button type="button" className={verifying ? "btn p" : "btn d"} disabled={busy || !!why} onClick={save}>{busy ? "Saving…" : verifying ? "Mark verified" : "Mark rejected"}</button></>}>
      <div className={mine && mine.connected ? "ok" : "warn"} style={{ marginBottom: 10 }}>{mine && mine.connected ? `You have spoken to them: ${talk(mine.talkSec)}. Record what came out of it.` : "You have not spoken to them yet. Call the candidate yourself first, then record what came out of it."}</div>
      <label className="fld">Outcome of your call (required)<textarea className="in" rows={3} placeholder="Genuine, suitable, positively interested…" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      {verifying && (
        <div className="row" style={{ marginTop: 10, gap: 14 }}>
          {[["genuine", "Genuine candidate"], ["suitable", "Suitable for the program"], ["interested", "Positively interested"]].map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6, fontSize: 13.5 }}><input type="checkbox" checked={checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} /> {l}</label>
          ))}
        </div>
      )}
      {verifying && missing.length > 0 && <div className="warn" style={{ marginTop: 10 }}><b>Missing details:</b> {missing.join(", ")}. Fill them from the lead popup.</div>}
      {needsExcuse && canExcuse && <label className="fld" style={{ marginTop: 10 }}>Exception reason (Sales Manager only)<textarea className="in" rows={2} value={exception} onChange={(e) => setException(e.target.value)} placeholder="Why this is verified without the call or the details" /></label>}
    </Modal>
  );
}

function RosterModal({ row, sunday, onClose, onSaved }) {
  const [f, setF] = useState({ sundayKey: sunday || "", restDayKey: "", plan: "", compensation: "", hrChecked: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const why = !f.sundayKey || !f.restDayKey ? "Pick both dates" : f.plan.trim().length < 5 ? "Write the work plan" : f.compensation.trim().length < 3 ? "Write the compensation" : !f.hrChecked ? "HR must confirm first" : "";
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: "workday/admin/360/roster", jsonData: { adminId: row.adminId, ...f } });
    setBusy(false);
    if (r?.success) {
      message.success(r.message || "Scheduled.");
      onSaved();
    } else message.error(r?.message || "Could not schedule.");
  };
  return (
    <Modal title={`Recovery Sunday · ${row.name}`} sub={`${row.by20 || 0} of ${row.targetProspects ?? "—"} verified prospects by the 20th`} onClose={onClose} width={560} footer={<>{why && <span className="mut" style={{ fontSize: 12.5, marginRight: "auto" }}>{why}</span>}<button type="button" className="btn g" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={busy || !!why} onClick={save}>{busy ? "Saving…" : "Schedule and notify"}</button></>}>
      <div className="fgrid">
        <label className="fld">Sunday<input className="in" type="date" value={f.sundayKey} onChange={set("sundayKey")} /></label>
        <label className="fld">Substitute rest day (within 7 days)<input className="in" type="date" value={f.restDayKey} onChange={set("restDayKey")} /></label>
      </div>
      <label className="fld" style={{ marginTop: 10 }}>Work plan<textarea className="in" rows={3} value={f.plan} onChange={set("plan")} placeholder="Backlog clearance, pending follow-ups, counselling, demos…" /></label>
      <label className="fld" style={{ marginTop: 10 }}>Overtime or other compensation<input className="in" value={f.compensation} onChange={set("compensation")} placeholder="Overtime pay, comp off…" /></label>
      <label className="row" style={{ gap: 8, marginTop: 10, fontSize: 13.5 }}><input type="checkbox" checked={f.hrChecked} onChange={(e) => setF((x) => ({ ...x, hrChecked: e.target.checked }))} /> HR has checked state law and any exemption for this Sunday.</label>
    </Modal>
  );
}

function WaiveModal({ row, month, onClose, onSaved }) {
  const [f, setF] = useState({ waived: row.backlogWaived || "", reason: row.backlogWaivedReason || "" });
  const [busy, setBusy] = useState(false);
  const why = f.waived === "" ? "Enter how many are waived" : String(f.reason).trim().length < 5 ? "Write the reason" : "";
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: "workday/admin/360/backlog-waive", jsonData: { adminId: row.adminId, period: month, ...f } });
    setBusy(false);
    if (r?.success) {
      message.success(r.message || "Saved.");
      onSaved();
    } else message.error(r?.message || "Could not save.");
  };
  return (
    <Modal title={`Waive backlog · ${row.name}`} sub={`Backlog now: ${row.backlog} prospects · ${dayjs(`${month}-01`).format("MMMM YYYY")}`} onClose={onClose} width={480} footer={<>{why && <span className="mut" style={{ fontSize: 12.5, marginRight: "auto" }}>{why}</span>}<button type="button" className="btn g" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={busy || !!why} onClick={save}>{busy ? "Saving…" : "Save waiver"}</button></>}>
      <label className="fld">Prospects waived<input className="in" type="number" min={0} value={f.waived} onChange={(e) => setF({ ...f, waived: e.target.value })} /></label>
      <label className="fld" style={{ marginTop: 10 }}>Reason (required)<textarea className="in" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
    </Modal>
  );
}

// Set targets — every person's monthly verified-prospect target, backlog and recovery Sunday.
function TargetsModal({ data, month, canManage, onClose, onChanged }) {
  const rows = data?.rows || [];
  const [draft, setDraft] = useState({});
  const [why, setWhy] = useState({});
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState(null);
  const changed = rows.filter((r) => draft[r.adminId] !== undefined && String(draft[r.adminId]) !== String(r.targetProspects ?? ""));
  const needWhy = changed.filter((r) => r.targetProspects != null && String(why[r.adminId] || "").trim().length < 3);
  const save = async () => {
    setBusy(true);
    let ok = 0;
    for (const r of changed) {
      const v = draft[r.adminId];
      const x = await request.post({ entity: "performance/targets", jsonData: { admin: r.adminId, period: month, targetProspects: v === "" ? null : Number(v), targetProspectsReason: why[r.adminId] || "" } });
      if (x?.success) ok += 1;
      else message.error(`${r.name}: ${x?.message || "could not save"}`);
    }
    setBusy(false);
    if (ok) message.success(`${ok} target${ok > 1 ? "s" : ""} saved. Each user is told.`);
    setDraft({});
    setWhy({});
    onChanged();
  };
  const cancelRoster = async (r) => {
    const x = await request.post({ entity: "workday/admin/360/roster/cancel", jsonData: { adminId: r.adminId, sundayKey: r.roster.sundayKey } });
    if (x?.success) onChanged();
    else message.error(x?.message || "Could not cancel.");
  };
  return (
    <>
      <Modal title="Set targets" sub={`${dayjs(`${month}-01`).format("MMMM YYYY")} · Team Leader verified prospects`} onClose={onClose} width={980} footer={<>{needWhy.length > 0 && <span className="mut" style={{ fontSize: 12.5, marginRight: "auto" }}>Write why {needWhy[0].name}’s target changes</span>}<button type="button" className="btn g" onClick={onClose}>Close</button><button type="button" className="btn p" disabled={busy || !changed.length || needWhy.length > 0} onClick={save}>{busy ? "Saving…" : `Save${changed.length ? ` ${changed.length}` : ""}`}</button></>}>
        <div className="tw">
          <table>
            <thead><tr><th scope="col">Person</th><th scope="col">Prospect target</th><th scope="col" className="num">Verified</th><th scope="col" className="num">By the 20th</th><th scope="col">Backlog</th><th scope="col">Recovery Sunday</th><th scope="col" className="num">Overdue</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const v = draft[r.adminId] ?? r.targetProspects ?? "";
                const isChanged = draft[r.adminId] !== undefined && String(draft[r.adminId]) !== String(r.targetProspects ?? "");
                return (
                  <tr key={r.adminId}>
                    <td><b>{r.name}</b><div className="mut" style={{ fontSize: 12 }}>{r.role}{r.team ? ` · ${r.team}` : ""}</div></td>
                    <td>
                      <input className="in" type="number" min={0} style={{ width: 90 }} aria-label={`Target for ${r.name}`} placeholder="Not set" value={v} onChange={(e) => setDraft((d) => ({ ...d, [r.adminId]: e.target.value }))} />
                      {isChanged && r.targetProspects != null && <input className="in" style={{ marginTop: 4, width: 180 }} placeholder="Why it changes" value={why[r.adminId] || ""} onChange={(e) => setWhy((w) => ({ ...w, [r.adminId]: e.target.value }))} />}
                    </td>
                    <td className="num">{nf(r.achieved)}</td>
                    <td className="num">{nf(r.by20)}</td>
                    <td>{r.backlog ? <span className="b or">{r.backlog}</span> : "0"}{r.backlogWaived ? <div className="mut" style={{ fontSize: 12 }}>{r.backlogWaived} waived</div> : null}{canManage && r.backlog > 0 && <div><button type="button" className="lnk" onClick={() => setSub({ kind: "waive", row: r })}>Waive</button></div>}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 240 }}>
                      {r.roster ? <><b>Scheduled</b> · rest day {dayjs(r.roster.restDayKey).format("D MMM")}<div className="mut" style={{ fontSize: 12 }}>{r.roster.plan}</div>{canManage && <button type="button" className="lnk" onClick={() => cancelRoster(r)}>Cancel</button>}</> : r.recoveryDue ? <><span className="b or">Target missed by the 20th</span>{canManage && <div><button type="button" className="lnk" onClick={() => setSub({ kind: "roster", row: r })}>Schedule</button></div>}</> : <span className="mut">Normal Sunday off</span>}
                    </td>
                    <td className="num">{nf(r.overdue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty />}
      </Modal>
      {sub?.kind === "waive" && <WaiveModal row={sub.row} month={month} onClose={() => setSub(null)} onSaved={() => { setSub(null); onChanged(); }} />}
      {sub?.kind === "roster" && <RosterModal row={sub.row} sunday={data?.lastSunday} onClose={() => setSub(null)} onSaved={() => { setSub(null); onChanged(); }} />}
    </>
  );
}

function NewCase({ people, canManage, onClose, onSaved }) {
  const [f, setF] = useState({ type: "dispute", adminId: "", dayKey: "", topic: "attendance", message: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const why = f.type !== "dispute" && !f.adminId ? "Pick the user" : f.message.trim().length < 5 ? "Write what this is about" : "";
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: "workday/admin/360/cases", jsonData: f });
    setBusy(false);
    if (r?.success) {
      message.success(r.message || "Saved.");
      onSaved();
    } else message.error(r?.message || "Could not save.");
  };
  return (
    <Modal title={canManage ? "New case" : "Raise a dispute"} onClose={onClose} width={540} footer={<>{why && <span className="mut" style={{ fontSize: 12.5, marginRight: "auto" }}>{why}</span>}<button type="button" className="btn g" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={busy || !!why} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="fgrid">
        {canManage && <label className="fld">Type<select className="sel" value={f.type} onChange={set("type")}>{Object.entries(CASE_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
        {canManage && <label className="fld">User<select className="sel" value={f.adminId} onChange={set("adminId")}><option value="">{f.type === "dispute" ? "Myself" : "Pick a user"}</option>{people.map((p) => <option key={p.adminId} value={p.adminId}>{p.name}</option>)}</select></label>}
        {f.type === "dispute" && <label className="fld">About<select className="sel" value={f.topic} onChange={set("topic")}><option value="attendance">Attendance</option><option value="dialer">Dialer</option><option value="task">Overdue task</option><option value="prospect">Prospect</option></select></label>}
        <label className="fld">Day (optional)<input className="in" type="date" value={f.dayKey} onChange={set("dayKey")} /></label>
      </div>
      <label className="fld" style={{ marginTop: 10 }}>{f.type === "review" ? "Findings and improvement plan" : "Details and evidence"}<textarea className="in" rows={4} value={f.message} onChange={set("message")} /></label>
    </Modal>
  );
}

function OutageModal({ people, onClose, onSaved }) {
  const [f, setF] = useState({ kind: "outage", from: "", to: "", adminIds: [], reason: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const why = !f.from || !f.to ? "Pick the start and end" : f.reason.trim().length < 5 ? "Write the reason" : "";
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: "workday/admin/360/outages", jsonData: { ...f, from: new Date(f.from).toISOString(), to: new Date(f.to).toISOString() } });
    setBusy(false);
    if (r?.success) {
      message.success(r.message || "Logged.");
      onSaved();
    } else message.error(r?.message || "Could not save.");
  };
  return (
    <Modal title="Log an outage, training or meeting" sub="This time counts as dialer time; no automatic short leave for it" onClose={onClose} width={560} footer={<>{why && <span className="mut" style={{ fontSize: 12.5, marginRight: "auto" }}>{why}</span>}<button type="button" className="btn g" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={busy || !!why} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="fgrid">
        <label className="fld">Kind<select className="sel" value={f.kind} onChange={set("kind")}>{Object.entries(OUTAGE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="fld">From<input className="in" type="datetime-local" value={f.from} onChange={set("from")} /></label>
        <label className="fld">To<input className="in" type="datetime-local" value={f.to} onChange={set("to")} /></label>
      </div>
      <label className="fld" style={{ marginTop: 10 }}>Who (none ticked = everyone)
        <select className="sel" multiple style={{ height: 120 }} value={f.adminIds} onChange={(e) => setF((x) => ({ ...x, adminIds: [...e.target.selectedOptions].map((o) => o.value) }))}>{people.map((p) => <option key={p.adminId} value={p.adminId}>{p.name}</option>)}</select>
      </label>
      <label className="fld" style={{ marginTop: 10 }}>Reason<textarea className="in" rows={3} value={f.reason} onChange={set("reason")} /></label>
    </Modal>
  );
}

const cellK = (u, lateAfter) => {
  if (!u) return "S";
  if (["present", "in-progress", "auto"].includes(u.status)) return u.lateMin > lateAfter ? "L" : "P";
  if (u.status === "half-day") return "H";
  if (u.status === "absent") return "A";
  if (u.status === "leave" || u.status === "late-leave") return "V";
  return "S";
};

export default function Team({ ownOnly }) {
  const me = useSelector(selectCurrentAdmin);
  const manager = FULL_ACCESS.includes(me?.role);
  const policyAdmin = POLICY_ADMIN.includes(me?.role);
  const canVerify = manager || me?.role === "Team Leader";
  const [tab, setTab] = useState("att");
  const [draft, setDraft] = useState(BLANK);
  const [f, setF] = useState(BLANK);
  const [hide, setHide] = useState({});
  const [modal, setModal] = useState(null);
  const [compTab, setCompTab] = useState("overdue");
  const [exTab, setExTab] = useState("login");
  const [busy, setBusy] = useState("");

  const curMonth = dayjs().format("YYYY-MM");
  const base = useMemo(() => {
    const m = dayjs(`${f.month}-01`);
    const end = m.endOf("month");
    const p = { from: m.startOf("month").toISOString(), to: (end.isAfter(dayjs()) ? dayjs() : end).toISOString() };
    if (f.adminId) p.adminId = f.adminId;
    if (f.attendance) p.attendance = f.attendance;
    if (f.late) p.late = f.late;
    if (f.short) p.short = f.short;
    if (f.dayType) p.dayType = f.dayType;
    return p;
  }, [f]);
  const qs = new URLSearchParams(base).toString();
  const listBase = new URLSearchParams({ from: base.from, to: base.to, ...(f.adminId ? { adminId: f.adminId } : {}) }).toString();
  const weekQs = new URLSearchParams({ from: monday().toISOString(), to: new Date().toISOString(), ...(f.adminId ? { adminId: f.adminId } : {}) }).toString();

  const att = useGet(`workday/admin/360/attendance?${new URLSearchParams({ month: f.month, ...(f.adminId ? { adminId: f.adminId } : {}) })}`);
  const attNow = useGet(f.month !== curMonth ? `workday/admin/360/attendance?${new URLSearchParams({ month: curMonth, ...(f.adminId ? { adminId: f.adminId } : {}) })}` : null);
  const exWeek = useGet(`workday/admin/360/exceptions?${weekQs}`);
  const ex = useGet(tab === "att" ? `workday/admin/360/exceptions?${listBase}` : null);
  const policy = useGet(tab === "policy" ? `workday/admin/360/policy-days?${qs}` : null);
  const team = useGet(tab === "pros" ? "calling/team-activity" : null);
  const prosQs = new URLSearchParams(canVerify && !manager ? { from: base.from, to: base.to } : { from: base.from, to: base.to, ...(f.adminId ? { adminId: f.adminId } : {}) }).toString();
  const pros = useGet(`workday/admin/360/prospects?${prosQs}`);
  const targets = useGet(tab === "pros" || modal?.kind === "targets" ? `workday/admin/360/targets?${new URLSearchParams({ month: f.month, ...(f.adminId ? { adminId: f.adminId } : {}) })}` : null);
  const cases = useGet(`workday/admin/360/cases?${listBase}`);
  const overdue = useGet(tab === "comp" ? `workday/admin/360/overdue?${listBase}` : null);
  const corrections = useGet(tab === "comp" ? `workday/admin/360/corrections?${listBase}` : null);
  const outages = useGet(tab === "comp" ? `workday/admin/360/outages?${listBase}` : null);

  const people = att.data?.people || [];
  const lateAfter = att.data?.lateAfterMin ?? 0;
  const waiting = (pros.data || []).filter((r) => !r.verification);
  const openCases = (cases.data || []).filter((c) => c.status === "open");

  // today's tiles (current month's grid)
  const nowData = f.month === curMonth ? att.data : attNow.data;
  const nowLoading = f.month === curMonth ? att.loading : attNow.loading;
  const tDay = (nowData?.days || []).find((d) => d.dayKey === todayKey());
  const tp = tDay?.people || [];
  const lateNow = nowData?.lateAfterMin ?? 0;
  const onTime = tp.filter((u) => u.loginAt && !(u.lateMin > lateNow)).length;
  const lateToday = tp.filter((u) => u.loginAt && u.lateMin > lateNow).length;
  const absentToday = tp.filter((u) => u.status === "absent").length;
  const leaveToday = tp.filter((u) => u.status === "leave" || u.status === "late-leave").length;

  const apply = (n) => {
    setF(n);
    setDraft(n);
  };
  const remind = async (adminId, name) => {
    setBusy(`remind|${adminId}`);
    const r = await request.post({ entity: "workday/admin/remind-login", jsonData: { adminId } });
    setBusy("");
    if (r?.success) message.success(r.message);
    else message.error(r?.message || `Could not remind ${name}.`);
  };
  const markPresent = async (row) => {
    setBusy(`${row.adminId}|${row.dayKey}`);
    const r = await request.post({ entity: "workday/admin/mark-present", jsonData: { adminId: row.adminId, dayKey: row.dayKey } });
    setBusy("");
    setModal(null);
    if (r?.success) {
      message.success(r.message);
      ex.reload();
      att.reload();
    } else message.error(r?.message || "Could not mark present.");
  };
  const callProspect = async (r) => {
    setBusy(`call|${r._id}`);
    const x = await request.post({ entity: "calling/manual/dial", jsonData: { phone: String(r.phone || "").replace(/[^\d+]/g, ""), contactName: r.name } });
    setBusy("");
    if (!x?.success) message.error(x?.message || "Could not place the call.");
  };
  const removeOutage = async (o) => {
    const r = await request.post({ entity: `workday/admin/360/outages/${o._id}/remove`, jsonData: {} });
    if (r?.success) outages.reload();
    else message.error(r?.message || "Could not remove.");
  };

  const TABS = [
    ["att", "Attendance", people.length || null],
    ["policy", "Policy verdict", "CLC-POL-001"],
    ["pros", "Prospects & targets", pros.data ? waiting.length : null],
    ["comp", "Compliance", cases.data ? openCases.length : null],
  ];

  // calendar
  const m0 = dayjs(`${f.month}-01`);
  const dim = m0.daysInMonth();
  const byKey = new Map((att.data?.days || []).map((d) => [d.dayKey, d]));
  const dayKeys = Array.from({ length: dim }, (_, i) => m0.add(i, "day").format("YYYY-MM-DD"));
  const passes = (u) => (!f.attendance || (u && u.status === f.attendance)) && (!f.late || (u && u.lateMin > lateAfter));
  // Attendance / Late filters used to only fade non-matching days, so the grid looked unfiltered:
  // keep only the people with at least one matching day (the days that do not match stay faded).
  const dayFilter = !!(f.attendance || f.late);
  const calPeople = dayFilter ? people.filter((p) => dayKeys.some((k) => { const u = byKey.get(k)?.people?.find((x) => x.adminId === p.adminId); return u && passes(u); })) : people;

  // stacked bar: leads assigned by stage (team-activity)
  const stackRows = (team.data || []).filter((u) => (!f.adminId || String(u._id) === String(f.adminId)) && u.leads?.total).map((u) => ({ id: u._id, name: u.name, by: u.leads.byStage || {} }));
  const stageKeys = [...new Set(stackRows.flatMap((r) => Object.keys(r.by)))].sort((a, b) => stackRows.reduce((t, r) => t + (r.by[b] || 0), 0) - stackRows.reduce((t, r) => t + (r.by[a] || 0), 0));
  const colorOf = (s) => STACK_C[stageKeys.indexOf(s) % STACK_C.length];
  const totOf = (r) => stageKeys.reduce((t, s) => t + (hide[s] ? 0 : r.by[s] || 0), 0);
  const maxStack = Math.max(1, ...stackRows.map(totOf));

  const tRows = (targets.data?.rows || []).filter((r) => r.targetProspects != null || r.achieved);
  const overdueOpen = (overdue.data?.rows || []).filter((t) => t.status === "open").length;

  return (
    <>
      <Head crumb="Sales › Team & Attendance" title={ownOnly ? "My Attendance" : "Team & Attendance"} lead="Attendance, policy, prospects, targets and compliance — and how each person’s leads are spread."><span className="src">workday/admin/360/attendance · /cases · /corrections · /outages</span></Head>
      <Tabs items={TABS} value={tab} onChange={setTab} label="Team & Attendance views" />

      <section className="fp" aria-label="Filters">
        <div className="fgrid">
          {manager && (
            <label className="fld">Sales user
              <select className="sel" value={draft.adminId} onChange={(e) => setDraft({ ...draft, adminId: e.target.value })}>
                <option value="">All users</option>
                {people.map((p) => <option key={p.adminId} value={p.adminId}>{p.name}</option>)}
              </select>
            </label>
          )}
          <label className="fld">Month
            <select className="sel" value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })}>
              {months().map((m) => <option key={m.format("YYYY-MM")} value={m.format("YYYY-MM")}>{m.format("MMMM YYYY")}</option>)}
            </select>
          </label>
          <label className="fld">Attendance
            <select className="sel" value={draft.attendance} onChange={(e) => setDraft({ ...draft, attendance: e.target.value })}>
              <option value="">All attendance</option><option value="present">Full day</option><option value="half-day">Half day</option><option value="absent">Absent</option><option value="in-progress">In progress</option><option value="leave">Leave</option>
            </select>
          </label>
          <label className="fld">Late
            <select className="sel" value={draft.late} onChange={(e) => setDraft({ ...draft, late: e.target.value })}><option value="">Late: all</option><option value="1">Late login</option></select>
          </label>
          <label className="fld">Short leave
            <select className="sel" value={draft.short} onChange={(e) => setDraft({ ...draft, short: e.target.value })}><option value="">Short leave: all</option><option value="1">Has short leave</option></select>
          </label>
          <label className="fld">Day type
            <select className="sel" value={draft.dayType} onChange={(e) => setDraft({ ...draft, dayType: e.target.value })}><option value="">All day types</option><option value="working">Scheduled working days</option><option value="recovery">Recovery Sundays</option></select>
          </label>
        </div>
        <div className="factions">
          <span />
          <div className="row">
            <button type="button" className="btn g" onClick={() => apply(BLANK)}>Reset</button>
            <button type="button" className="btn p" onClick={() => apply(draft)}>Apply</button>
          </div>
        </div>
      </section>

      {tab === "att" && (
        <>
          <div className="kpis">
            {[
              ["✓", "On time today", nf(onTime), `login by ${hhmm(600 + lateNow)}`, ""],
              ["!", "Late today", nf(lateToday), "after the grace time", "late"],
              ["✕", "Absent / leave", `${nf(absentToday)} / ${nf(leaveToday)}`, "today", "abs"],
              ["⏱", "Missed logout", exWeek.data ? nf((exWeek.data.noLogout || []).length) : "—", "this week", ""],
            ].map(([i, l, v, d, k]) => (
              <div key={l} className="kpi">
                <div className="l"><i style={k === "late" ? { background: "#FEF0E6", color: "#B54708" } : k === "abs" ? { background: "#EEF2F6", color: "#1E293B" } : undefined}>{i}</i>{l}</div>
                <div className="v">{nowLoading ? <span className="skel" style={{ display: "block", height: 26, width: "60%" }} /> : v}</div>
                <div className={k === "late" ? "d dn" : "d mut"}>{d}</div>
              </div>
            ))}
          </div>

          <div className="card sv3-cal">
            <div className="ch">
              <div><h3>{m0.format("MMMM")} · day by day</h3><p>Hover a day for login / logout</p></div>
              <div className="legend"><span><i className="dot P" />Full</span><span><i className="dot H" />Half</span><span><i className="dot L" />Late</span><span><i className="dot A" />Absent</span><span><i className="dot V" />Leave</span><span><i className="dot S" />Sunday / ahead</span></div>
            </div>
            {att.error ? <Fail onRetry={att.reload} /> : att.loading ? <Skel h={220} /> : !calPeople.length ? <Empty text={dayFilter ? "Nobody matches these filters this month." : undefined} /> : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th className="n" scope="col">Person</th>{dayKeys.map((k) => <th key={k} scope="col" className={k === todayKey() ? "today" : undefined}>{Number(k.slice(8))}</th>)}</tr></thead>
                  <tbody>
                    {calPeople.map((p) => (
                      <tr key={p.adminId}>
                        <th className="n" scope="row"><AgentLnk adminId={p.adminId} name={p.name} /></th>
                        {dayKeys.map((k) => {
                          const d = byKey.get(k);
                          const u = d?.people?.find((x) => x.adminId === p.adminId);
                          const c = cellK(u, lateAfter);
                          const tip = u ? `${p.name} · ${dayjs(k).format("D MMM")} · ${ATT[u.status] || u.status}${u.loginAt ? ` · login ${clock(u.loginAt)}` : ""}${u.logoutAt ? ` → logout ${clock(u.logoutAt)}` : ""}${u.lateMin > lateAfter ? ` · late ${hm(u.lateMin)}` : ""}${d?.holiday ? ` · ${d.holiday}` : ""}` : dayjs(k).format("D MMM");
                          // The letter makes the status readable without telling colours apart (Late vs Leave); today is ringed.
                          return <td key={k} className={`${c}${k === todayKey() ? " today" : ""}`} title={tip} aria-label={tip} style={c !== "S" && !passes(u) ? { opacity: 0.2 } : undefined}>{c === "S" ? "" : c === "V" ? "Lv" : c}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="ch">
              <div><h3>Missed login / logout</h3><p>{m0.format("MMMM YYYY")} · worked without Login, or never pressed Logout</p></div>
              <div className="seg" role="group" aria-label="Which">
                <button type="button" className={exTab === "login" ? "on" : ""} onClick={() => setExTab("login")}>No login · {nf((ex.data?.noLogin || []).filter((x) => !x.markedPresentBy).length)}</button>
                <button type="button" className={exTab === "logout" ? "on" : ""} onClick={() => setExTab("logout")}>No logout · {nf((ex.data?.noLogout || []).length)}</button>
              </div>
            </div>
            {ex.error ? <Fail onRetry={ex.reload} /> : ex.loading ? <Skel h={140} /> : exTab === "login" ? (
              (ex.data?.noLogin || []).length === 0 ? <Empty text="Everyone who worked pressed Login." /> : (
                <div className="tw">
                  <table>
                    <thead><tr><th scope="col">Date</th><th scope="col">Person</th><th scope="col">Dialer came on</th><th scope="col">Auto-started</th><th scope="col" className="num">Calls</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Action</span></th></tr></thead>
                    <tbody>
                      {ex.data.noLogin.map((r) => (
                        <tr key={`${r.adminId}|${r.dayKey}|${r.markedPresentBy ? "m" : ""}`}>
                          <td><b>{dayjs(r.dayKey).format("D MMM")}</b> <span className="mut">{dayjs(r.dayKey).format("ddd")}</span></td>
                          <td><AgentLnk adminId={r.adminId} name={r.name} /></td>
                          <td>{r.dialerOnAt ? <>{clock(r.dialerOnAt)}<div className="mut" style={{ fontSize: 12 }}>{!r.dialerOnBy || r.dialerOnBy === "System" ? "auto-start" : r.dialerOnBy === r.name ? "by self" : `by ${r.dialerOnBy}`}</div></> : "—"}</td>
                          <td>{r.autoStartedAt ? clock(r.autoStartedAt) : "—"}</td>
                          <td className="num">{r.calls ? <><b>{r.calls}</b><div className="mut" style={{ fontSize: 12 }}>{r.connected} connected</div></> : "0"}</td>
                          <td style={{ textAlign: "right" }}>
                            {r.markedPresentBy ? <span className="b gr">Present · by {r.markedPresentBy}</span> : manager && !r.calls && r.dayKey !== todayKey() ? <span className="mut">No calls — absent</span> : manager ? (
                              <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                                {r.dayKey === todayKey() && <button type="button" className="btn sm" disabled={busy === `remind|${r.adminId}`} onClick={() => remind(r.adminId, r.name)}>Remind</button>}
                                {r.calls > 0 && <button type="button" className="btn sm p" onClick={() => setModal({ kind: "present", row: r })}>Mark present</button>}
                              </div>
                            ) : <span className="b or">No login</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (ex.data?.noLogout || []).length === 0 ? <Empty text="Everyone who logged in also logged out." /> : (
              <div className="tw">
                <table>
                  <thead><tr><th scope="col">Date</th><th scope="col">Person</th><th scope="col">Login</th><th scope="col">Counted to</th><th scope="col" className="num">Calls</th><th scope="col">Email</th></tr></thead>
                  <tbody>
                    {ex.data.noLogout.map((r) => (
                      <tr key={`${r.adminId}|${r.dayKey}`}>
                        <td><b>{dayjs(r.dayKey).format("D MMM")}</b> <span className="mut">{dayjs(r.dayKey).format("ddd")}</span></td>
                        <td><AgentLnk adminId={r.adminId} name={r.name} /></td>
                        <td>{clock(r.loginAt)}</td>
                        <td className="mut">{r.countedTo ? clock(r.countedTo) : "—"} (shift end)</td>
                        <td className="num">{nf(r.calls)}</td>
                        <td>{r.emailedAt ? <span className="b bl">Emailed {clock(r.emailedAt)}</span> : <span className="mut">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "policy" && (
        <div className="card">
          <div className="ch"><div><h3>Attendance by policy · CLC-POL-001</h3><p>Dialer hours, attempts, talk, verified prospects, demos, short leave — per working day</p></div>{policy.data && <span className="b gy">{nf(policy.data.count)} days</span>}</div>
          {policy.error ? <Fail onRetry={policy.reload} /> : policy.loading ? <Skel h={240} /> : !(policy.data?.rows || []).length ? <Empty /> : (
            <div className="tw">
              <table>
                <thead><tr><th scope="col">Day</th><th scope="col">Person</th><th scope="col" className="num">Dialer</th><th scope="col" className="num">Attempts</th><th scope="col" className="num">Talk</th><th scope="col" className="num">Prospects</th><th scope="col" className="num">Demos</th><th scope="col">Verdict</th>{policyAdmin && <th scope="col"><span style={{ position: "absolute", left: -9999 }}>Action</span></th>}</tr></thead>
                <tbody>
                  {policy.data.rows.slice(0, 500).map((r) => {
                    const m = r.policy?.metrics;
                    const shown = r.policy?.preview ? LEVEL_TO_STATUS[r.policy.level] || r.status : r.status;
                    return (
                      <tr key={`${r.adminId}-${r.dayKey}`}>
                        <td><b>{dayjs(r.dayKey).format("D MMM")}</b> <span className="mut">{dayjs(r.dayKey).format("ddd")}</span>{r.dayType === "recovery" && <div className="mut" style={{ fontSize: 12 }}>Recovery Sunday</div>}</td>
                        <td><AgentLnk adminId={r.adminId} name={r.name} /></td>
                        <td className="num">{m ? hm(m.dialerMin) : "—"}</td>
                        <td className="num">{m ? nf(m.attempts) : "—"}</td>
                        <td className="num">{m ? hm(Math.floor((m.talkSec || 0) / 60)) : "—"}</td>
                        <td className="num">{m ? m.verifiedProspects : "—"}</td>
                        <td className="num">{m ? m.attendedDemos : "—"}</td>
                        <td>
                          <span className={VERDICT_B[shown] || "b gy"}>{ATT[shown] || shown}</span>
                          {r.policy?.preview && <div className="mut" style={{ fontSize: 12 }}>preview · kept as {ATT[r.status] || r.status}</div>}
                          {r.shortLeave > 0 && <div className="mut" style={{ fontSize: 12 }}>{r.shortLeave} short leave</div>}
                          {r.correction && <div className="mut" style={{ fontSize: 12 }} title={r.correction.reason}>corrected by {r.correction.by}</div>}
                        </td>
                        {policyAdmin && <td><button type="button" className="btn sm" onClick={() => setModal({ kind: "correct", row: r })}>Correct</button></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "pros" && (
        <>
          <div className="card">
            <div className="ch"><div><h3>Sales user × lead status</h3><p>Stacked bar · click a legend item to hide it</p></div><span className="src">calling/team-activity → leads</span></div>
            {team.error ? <Fail onRetry={team.reload} /> : team.loading ? <Skel h={220} /> : !stackRows.length ? <Empty /> : (
              <>
                <div className="row" style={{ marginBottom: 12, gap: 6 }}>
                  {stageKeys.map((s) => <button key={s} type="button" className={hide[s] ? "sv3-lg off" : "sv3-lg"} aria-pressed={!hide[s]} onClick={() => setHide((h) => ({ ...h, [s]: !h[s] }))}><i className="dot" style={{ background: colorOf(s) }} />{s}</button>)}
                </div>
                {stackRows.sort((a, b) => totOf(b) - totOf(a)).map((r) => (
                  <div key={r.id} className="hb" style={{ gridTemplateColumns: "120px 1fr 50px" }}>
                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><AgentLnk adminId={r.id} name={r.name} /></span>
                    <span className="t" style={{ height: 22, borderRadius: 6, display: "flex" }}>
                      {stageKeys.filter((s) => !hide[s] && r.by[s]).map((s) => <b key={s} style={{ width: `${(r.by[s] / maxStack) * 100}%`, background: colorOf(s) }} title={`${r.name} · ${s}: ${nf(r.by[s])}`} />)}
                    </span>
                    <span className="n">{nf(totOf(r))}</span>
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="g2">
            <div className="card">
              <div className="ch"><h3>Prospect verification</h3><span className="b or">{pros.data ? `${nf(waiting.length)} waiting` : "…"}</span></div>
              {pros.error ? <Fail onRetry={pros.reload} /> : pros.loading ? <Skel h={160} /> : !waiting.length ? <Empty text="Nothing is waiting for verification." /> : (
                <div className="tw">
                  <table style={{ minWidth: 480 }}>
                    <thead><tr><th scope="col">Prospect</th><th scope="col">Sent by</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Action</span></th></tr></thead>
                    <tbody>
                      {waiting.map((r) => (
                        <tr key={r._id}>
                          <td><LeadLnk phone={r.phone} ink>{r.name || "—"}</LeadLnk>{(r.missing || []).length > 0 && <div className="mut" style={{ fontSize: 12 }}>missing: {r.missing.join(", ")}</div>}</td>
                          <td>{r.owner || "—"}<div className="mut" style={{ fontSize: 12 }}>{when(r.raisedAt)}</div></td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {canVerify ? (
                              <>
                                <button type="button" className="btn sm" disabled={busy === `call|${r._id}`} onClick={() => callProspect(r)}>{busy === `call|${r._id}` ? "Calling…" : "Call"}</button>{" "}
                                <button type="button" className="btn sm p" onClick={() => setModal({ kind: "decide", row: r, status: "verified" })}>Verify</button>{" "}
                                <button type="button" className="btn sm" onClick={() => setModal({ kind: "decide", row: r, status: "rejected" })}>Reject</button>
                              </>
                            ) : <span className="b or">Waiting</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="card">
              <div className="ch"><h3>Monthly target · verified prospects</h3>{policyAdmin && <button type="button" className="btn sm" onClick={() => setModal({ kind: "targets" })}>Set targets</button>}</div>
              {targets.error ? <Fail onRetry={targets.reload} /> : targets.loading ? <Skel h={160} /> : !tRows.length ? <Empty text="No target set for this month yet." /> : tRows.map((r) => {
                const p = r.targetProspects ? Math.min(100, (r.achieved / r.targetProspects) * 100) : 0;
                return (
                  <div key={r.adminId} className="hb">
                    <span>{r.name}</span>
                    <span className="t"><b style={{ width: `${p}%`, background: p >= 50 ? "#0F766E" : "#EA580C" }} /></span>
                    <span className="n">{nf(r.achieved)} / {r.targetProspects ?? "—"}</span>
                  </div>
                );
              })}
              <p className="mut" style={{ fontSize: 12, margin: "6px 0 0" }}>Backlog and recovery Sunday as today.</p>
            </div>
          </div>
        </>
      )}

      {tab === "comp" && (
        <>
          <div className="g2">
            <div className="card">
              <div className="ch"><h3>Waiting for your OK</h3></div>
              {cases.error ? <Fail onRetry={cases.reload} /> : cases.loading ? <Skel h={140} /> : !openCases.length ? <Empty text="Nothing is waiting." /> : (
                <div className="tw">
                  <table style={{ minWidth: 520 }}>
                    <thead><tr><th scope="col">Person</th><th scope="col">Ask</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Action</span></th></tr></thead>
                    <tbody>
                      {openCases.map((c) => (
                        <tr key={c._id}>
                          <td>{c.adminName || "—"}{c.dayKey && <div className="mut" style={{ fontSize: 12 }}>{dayjs(c.dayKey).format("D MMM")}</div>}</td>
                          <td style={{ whiteSpace: "normal", maxWidth: 320 }}><span className={CASE_B[c.type] || "b gy"}>{CASE_TYPE[c.type] || c.type}</span> {c.message}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {policyAdmin ? (c.type === "dispute" ? (
                              <>
                                <button type="button" className="btn sm p" onClick={() => setModal({ kind: "text", action: { entity: `workday/admin/360/cases/${c._id}/decide`, body: { status: "accepted" }, field: "decision", title: `Approve: ${CASE_TYPE[c.type]}`, sub: c.adminName, label: "Decision", ok: "Approve" }, after: cases.reload })}>Approve</button>{" "}
                                <button type="button" className="btn sm" onClick={() => setModal({ kind: "text", action: { entity: `workday/admin/360/cases/${c._id}/decide`, body: { status: "rejected" }, field: "decision", title: `Reject: ${CASE_TYPE[c.type]}`, sub: c.adminName, label: "Decision", ok: "Reject" }, after: cases.reload })}>Reject</button>
                              </>
                            ) : <button type="button" className="btn sm" onClick={() => setModal({ kind: "text", action: { entity: `workday/admin/360/cases/${c._id}/decide`, body: { status: "closed" }, field: "decision", title: `Close: ${CASE_TYPE[c.type]}`, sub: c.adminName, label: "Decision", ok: "Close" }, after: cases.reload })}>Close</button>) : <span className="b or">Open</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="card">
              <div className="ch"><h3>Overdue tasks · Cases · Outages</h3></div>
              <div className="kv">
                <span>Overdue tasks</span><span>{overdue.data ? <span className="b or">{nf(overdueOpen)} open</span> : "…"}</span>
                <span>Disputes &amp; reviews</span><span>{cases.data ? <span className="b gy">{nf(openCases.length)} open</span> : "…"}</span>
                <span>Outages / training</span><span>{outages.data ? <span className="b bl">{nf(outages.data.length)} logged</span> : "…"}</span>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                {policyAdmin && <button type="button" className="btn sm" onClick={() => setModal({ kind: "outage" })}>Log outage</button>}
                <button type="button" className="btn sm" onClick={() => setModal({ kind: "case" })}>{policyAdmin ? "New case" : "Raise a dispute"}</button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="ch"><div><h3>The full registers</h3><p>{m0.format("MMMM YYYY")}</p></div>
              <div className="seg" role="group" aria-label="Register">
                {[["overdue", "Overdue tasks"], ["cases", "All cases"], ["corrections", "Corrections"], ["outages", "Outages"]].map(([k, l]) => <button key={k} type="button" className={compTab === k ? "on" : ""} onClick={() => setCompTab(k)}>{l}</button>)}
              </div>
            </div>
            {compTab === "overdue" && (overdue.error ? <Fail onRetry={overdue.reload} /> : overdue.loading ? <Skel h={160} /> : !(overdue.data?.rows || []).length ? <Empty /> : (
              <>
                {(overdue.data.repeated || []).map((x) => <div key={x.adminId} className="warn" style={{ marginBottom: 8 }}>{x.name}: short-leave level on {x.days} days in this range — a repeated pattern; open a performance review.</div>)}
                {policyAdmin && (overdue.data.summary || []).filter((d) => d.events && d.count > d.recorded).length > 0 && (
                  <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                    {overdue.data.summary.filter((d) => d.events && d.count > d.recorded).map((d) => (
                      <button key={`${d.adminId}${d.dayKey}`} type="button" className="btn sm" onClick={() => setModal({ kind: "text", action: { entity: "workday/admin/360/overdue/record", body: { adminId: d.adminId, dayKey: d.dayKey }, field: "note", title: `Record ${d.events} short-leave event${d.events > 1 ? "s" : ""}`, sub: `${d.name} · ${dayjs(d.dayKey).format("D MMM")}`, label: "Review note", ok: "Record" }, after: overdue.reload })}>{d.name}, {dayjs(d.dayKey).format("D MMM")}: {d.count} overdue → record {d.events}</button>
                    ))}
                  </div>
                )}
                <div className="tw">
                  <table>
                    <thead><tr><th scope="col">Due</th><th scope="col">Person</th><th scope="col">Task</th><th scope="col">Lead</th><th scope="col">Status</th><th scope="col">Reason / review</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Action</span></th></tr></thead>
                    <tbody>
                      {overdue.data.rows.map((t) => {
                        const st = TASK_STATE[t.status] || [t.status, "b gy"];
                        const live = t.status === "open" || t.status === "explained";
                        return (
                          <tr key={t._id}>
                            <td>{when(t.dueAt)}</td>
                            <td>{t.adminName}</td>
                            <td>{TASK_KIND[t.kind] || t.kind}</td>
                            <td><LeadLnk phone={t.phone} ink>{t.leadName || "—"}</LeadLnk></td>
                            <td><span className={st[1]}>{st[0]}</span></td>
                            <td style={{ whiteSpace: "normal", maxWidth: 280 }}>{t.explanation || "—"}{t.reviewNote && <div className="mut" style={{ fontSize: 12 }}>{t.reviewedByName}: {t.reviewNote}</div>}</td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {live && String(t.admin) === String(me?._id) && <button type="button" className="btn sm" onClick={() => setModal({ kind: "text", action: { entity: `workday/admin/360/overdue/${t._id}/explain`, body: {}, field: "explanation", title: "Why is this overdue?", sub: t.leadName, label: "Reason", ok: "Send" }, after: overdue.reload })}>Give reason</button>}
                              {live && canVerify && <button type="button" className="btn sm" style={{ marginLeft: 6 }} onClick={() => setModal({ kind: "text", action: { entity: `workday/admin/360/overdue/${t._id}/exclude`, body: {}, field: "note", title: "Exclude from the count", sub: `${t.adminName} · ${t.leadName}`, label: "Why it was outside their control", ok: "Exclude" }, after: overdue.reload })}>Exclude</button>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ))}
            {compTab === "cases" && (cases.error ? <Fail onRetry={cases.reload} /> : cases.loading ? <Skel h={160} /> : !(cases.data || []).length ? <Empty /> : (
              <div className="tw">
                <table>
                  <thead><tr><th scope="col">Raised</th><th scope="col">Person</th><th scope="col">Type</th><th scope="col">Details</th><th scope="col">Status</th><th scope="col">Decision</th></tr></thead>
                  <tbody>
                    {cases.data.map((c) => (
                      <tr key={c._id}>
                        <td>{when(c.created)}<div className="mut" style={{ fontSize: 12 }}>by {c.raisedByName}</div></td>
                        <td>{c.adminName}{c.dayKey && <div className="mut" style={{ fontSize: 12 }}>{dayjs(c.dayKey).format("D MMM YYYY")}</div>}</td>
                        <td>{CASE_TYPE[c.type] || c.type}<div className="mut" style={{ fontSize: 12 }}>{c.topic}</div></td>
                        <td style={{ whiteSpace: "pre-wrap", maxWidth: 320 }}>{c.message}</td>
                        <td><span className={(CASE_STATE[c.status] || [])[1] || "b gy"}>{(CASE_STATE[c.status] || [c.status])[0]}</span></td>
                        <td style={{ whiteSpace: "normal", maxWidth: 260 }}>{c.decision || "—"}{c.decidedByName && <div className="mut" style={{ fontSize: 12 }}>{c.decidedByName} · {when(c.decidedAt)}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {compTab === "corrections" && (corrections.error ? <Fail onRetry={corrections.reload} /> : corrections.loading ? <Skel h={160} /> : !(corrections.data || []).length ? <Empty /> : (
              <div className="tw">
                <table>
                  <thead><tr><th scope="col">Day</th><th scope="col">Person</th><th scope="col">Original</th><th scope="col">Revised</th><th scope="col">Asked by</th><th scope="col">Approved by</th><th scope="col">Time</th><th scope="col">Reason</th></tr></thead>
                  <tbody>
                    {corrections.data.map((c) => (
                      <tr key={c._id}>
                        <td>{dayjs(c.dayKey).format("D MMM YYYY")}</td>
                        <td>{c.adminName}</td>
                        <td>{ATT[c.originalStatus] || c.originalStatus}<div className="mut" style={{ fontSize: 12 }}>{c.originalShortLeave || 0} short leave</div></td>
                        <td>{c.revisedStatus ? ATT[c.revisedStatus] || c.revisedStatus : "same"}<div className="mut" style={{ fontSize: 12 }}>{c.revisedShortLeave ?? c.originalShortLeave ?? 0} short leave</div></td>
                        <td>{c.requestedBy}</td>
                        <td>{c.approvedByName}</td>
                        <td>{when(c.created)}</td>
                        <td style={{ whiteSpace: "normal", maxWidth: 300 }}>{c.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {compTab === "outages" && (outages.error ? <Fail onRetry={outages.reload} /> : outages.loading ? <Skel h={160} /> : !(outages.data || []).length ? <Empty /> : (
              <div className="tw">
                <table>
                  <thead><tr><th scope="col">Kind</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Who</th><th scope="col">Reason</th><th scope="col">Logged by</th>{policyAdmin && <th scope="col"><span style={{ position: "absolute", left: -9999 }}>Action</span></th>}</tr></thead>
                  <tbody>
                    {outages.data.map((o) => (
                      <tr key={o._id}>
                        <td>{OUTAGE_KIND[o.kind] || o.kind}</td>
                        <td>{when(o.from)}</td>
                        <td>{when(o.to)}</td>
                        <td style={{ whiteSpace: "normal" }}>{(o.adminNames || []).join(", ") || "Everyone"}</td>
                        <td style={{ whiteSpace: "normal", maxWidth: 300 }}>{o.reason}</td>
                        <td>{o.byName}</td>
                        {policyAdmin && <td><button type="button" className="btn sm d" onClick={() => setModal({ kind: "rmOutage", row: o })}>Remove</button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}

      {modal?.kind === "present" && (
        <Modal title={`Mark ${modal.row.name} present on ${dayjs(modal.row.dayKey).format("D MMM")}?`} sub="They never pressed Login that day" onClose={() => setModal(null)} width={480} footer={<><button type="button" className="btn g" onClick={() => setModal(null)}>Cancel</button><button type="button" className="btn p" disabled={busy === `${modal.row.adminId}|${modal.row.dayKey}`} onClick={() => markPresent(modal.row)}>Mark present</button></>}>
          <div className="mut">Their start will be taken as {modal.row.dialerOnAt ? `${clock(modal.row.dialerOnAt)}, when the dialer came on` : modal.row.firstCallAt ? `${clock(modal.row.firstCallAt)}, their first call` : "their first activity"}.</div>
        </Modal>
      )}
      {modal?.kind === "rmOutage" && (
        <Modal title="Remove this log?" sub={`${OUTAGE_KIND[modal.row.kind] || modal.row.kind} · ${when(modal.row.from)}`} onClose={() => setModal(null)} width={460} footer={<><button type="button" className="btn g" onClick={() => setModal(null)}>Cancel</button><button type="button" className="btn d" onClick={() => { removeOutage(modal.row); setModal(null); }}>Remove</button></>}>
          <div className="mut">That time stops counting as dialer time for the people on it.</div>
        </Modal>
      )}
      {modal?.kind === "correct" && <CorrectModal row={modal.row} onClose={() => setModal(null)} onSaved={() => { setModal(null); policy.reload(); att.reload(); }} />}
      {modal?.kind === "decide" && <DecideModal row={modal.row} status={modal.status} meId={me?._id} canExcuse={["owner", "Owner", "Super Admin", "Admin", "Sales Manager"].includes(me?.role)} onClose={() => setModal(null)} onSaved={() => { setModal(null); pros.reload(); targets.reload(); }} />}
      {modal?.kind === "targets" && <TargetsModal data={targets.data} month={f.month} canManage={policyAdmin} onClose={() => setModal(null)} onChanged={targets.reload} />}
      {modal?.kind === "case" && <NewCase people={people} canManage={policyAdmin} onClose={() => setModal(null)} onSaved={() => { setModal(null); cases.reload(); }} />}
      {modal?.kind === "outage" && <OutageModal people={people} onClose={() => setModal(null)} onSaved={() => { setModal(null); outages.reload(); }} />}
      {modal?.kind === "text" && <TextAction action={modal.action} onClose={() => setModal(null)} onSaved={() => { const after = modal.after; setModal(null); after && after(); }} />}
    </>
  );
}
