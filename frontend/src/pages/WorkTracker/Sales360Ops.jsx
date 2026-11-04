import React, { useEffect, useState } from "react";
import { Input, message } from "antd";
import dayjs from "dayjs";
import { AlertOutlined, AuditOutlined, ClockCircleOutlined, MessageOutlined } from "@ant-design/icons";
import { request } from "@/request";
import { FormModal } from "./Sales360Policy";

// CLC-POL-001 on Sales 360°: overdue tasks (section 10), disputes, reviews and
// conduct (13, 14), the corrections register (14) and the outage log (6.1).
// Every list follows the page's filter bar through `base`.
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

function Panel({ title, icon, extra, children }) {
  return (
    <section className="s3-panel">
      <header>
        <h4>{icon} {title}</h4>
        {extra}
      </header>
      {children}
    </section>
  );
}
function Pill({ color, children }) {
  return <span className="s3-pill" style={{ "--c": color }}>{children}</span>;
}
// A popup that asks for one piece of text and posts it.
function TextAction({ action, onClose, onSaved }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(""), [action]);
  if (!action) return null;
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: action.entity, jsonData: { ...action.body, [action.field]: value } });
    setBusy(false);
    if (r?.success) onSaved();
    else message.error(r?.message || "Could not save.");
  };
  return (
    <FormModal title={action.title} subtitle={action.subtitle} okText={action.ok} busy={busy} why={value.trim().length < 5 ? `Write the ${action.label.toLowerCase()}` : ""} onOk={save} onClose={onClose}>
      <div className="s3p-form">
        <label>{action.label}
          <Input.TextArea rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
      </div>
    </FormModal>
  );
}

const TASK_STATE = { open: ["Open", "#B45309"], explained: ["Reason given", "#0369A1"], excluded: ["Excluded", "#64748B"], recorded: ["Short leave recorded", "#B91C1C"] };
const TASK_KIND = { callback: "Callback", demo: "Demo", followup: "Follow-up" };

export function OverduePanel({ base, meId, canReview, canRecord }) {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  const [action, setAction] = useState(null);
  useEffect(() => {
    let live = true;
    request.get({ entity: `workday/admin/360/overdue?${new URLSearchParams(base)}` }).then((r) => live && setData(r?.success ? r.result : { rows: [], summary: [], repeated: [] }));
    return () => {
      live = false;
    };
  }, [base, tick]);
  const rows = data?.rows || [];
  return (
    <Panel title={`Overdue tasks · ${rows.length}`} icon={<ClockCircleOutlined />}>
      {(data?.repeated || []).map((x) => <div key={x.adminId} className="s3-alert" role="status">{x.name}: short-leave level on {x.days} days in this range. This is a repeated pattern: open a performance review below.</div>)}
      {canRecord && (data?.summary || []).filter((d) => d.events && d.count > d.recorded).length > 0 && (
        <div className="s3p-counts">
          {data.summary.filter((d) => d.events && d.count > d.recorded).map((d) => (
            <button key={`${d.adminId}${d.dayKey}`} type="button" className="s3-link" onClick={() => setAction({ entity: "workday/admin/360/overdue/record", body: { adminId: d.adminId, dayKey: d.dayKey }, field: "note", title: `Record ${d.events} short-leave event${d.events === 1 ? "" : "s"}`, subtitle: `${d.name} · ${dayjs(d.dayKey).format("D MMM")} · ${d.count} overdue`, label: "Review note", ok: "Record" })}>
              {d.name}, {dayjs(d.dayKey).format("D MMM")}: {d.count} overdue, record {d.events}
            </button>
          ))}
        </div>
      )}
      <div className="hub-table-wrapper">
        <table className="hub-table s3-table">
          <thead><tr><th>Due</th><th>User</th><th>Task</th><th>Lead</th><th>Status</th><th>Reason / review</th><th /></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={7}><div className="s3-skel-rows"><i /><i /></div></td></tr>}
            {data && !rows.length && <tr><td colSpan={7}><div className="s3-empty">No overdue task matches these filters.</div></td></tr>}
            {rows.map((t) => {
              const st = TASK_STATE[t.status];
              const live = t.status === "open" || t.status === "explained";
              return (
                <tr key={t._id}>
                  <td style={{ whiteSpace: "nowrap" }}>{when(t.dueAt)}</td>
                  <td>{t.adminName}</td>
                  <td>{TASK_KIND[t.kind]}</td>
                  <td><b>{t.leadName}</b><div className="s3-muted">{t.phone}</div></td>
                  <td><Pill color={st[1]}>{st[0]}</Pill></td>
                  <td style={{ maxWidth: 280 }}>{t.explanation || "—"}{t.reviewNote && <div className="s3-muted">{t.reviewedByName}: {t.reviewNote}</div>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {live && String(t.admin) === String(meId) && <button type="button" className="s3-link" onClick={() => setAction({ entity: `workday/admin/360/overdue/${t._id}/explain`, body: {}, field: "explanation", title: "Why is this overdue?", subtitle: `${TASK_KIND[t.kind]} · ${t.leadName}`, label: "Reason", ok: "Save" })}>Give reason</button>}
                    {live && canReview && <button type="button" className="s3-link" style={{ marginLeft: 8 }} onClick={() => setAction({ entity: `workday/admin/360/overdue/${t._id}/exclude`, body: {}, field: "note", title: "Exclude from the count", subtitle: `${TASK_KIND[t.kind]} · ${t.leadName}`, label: "Why it was outside their control", ok: "Exclude" })}>Exclude</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="s3-note">One overdue task is a reminder. 2 to 3 in a day can be one short-leave event, 4 or more two, only after review. Excluded tasks don't count.</p>
      <TextAction action={action} onClose={() => setAction(null)} onSaved={() => { setAction(null); setTick((x) => x + 1); }} />
    </Panel>
  );
}

const CASE_TYPE = { dispute: "Dispute", review: "Performance review", conduct: "Conduct" };
const CASE_STATE = { open: ["Open", "#B45309"], accepted: ["Accepted", "#15803D"], rejected: ["Rejected", "#B91C1C"], closed: ["Closed", "#64748B"] };

function NewCase({ open, people, canManage, onClose, onSaved }) {
  const blank = { type: "dispute", adminId: "", dayKey: "", topic: "attendance", message: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF(blank);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: "workday/admin/360/cases", jsonData: f });
    setBusy(false);
    if (r?.success) onSaved();
    else message.error(r?.message || "Could not save.");
  };
  const needUser = f.type !== "dispute" && !f.adminId;
  return (
    <FormModal title={canManage ? "New case" : "Raise a dispute"} okText="Save" busy={busy} why={needUser ? "Pick the user" : f.message.trim().length < 5 ? "Write what this is about" : ""} onOk={save} onClose={onClose}>
      <div className="s3p-form">
        {canManage && (
          <label>Type
            <select className="hub-select" value={f.type} onChange={set("type")}>
              {Object.entries(CASE_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        )}
        {canManage && (
          <label>User
            <select className="hub-select" value={f.adminId} onChange={set("adminId")}>
              <option value="">{f.type === "dispute" ? "Myself" : "Pick a user"}</option>
              {(people || []).map((p) => <option key={p.adminId} value={p.adminId}>{p.name}</option>)}
            </select>
          </label>
        )}
        {f.type === "dispute" && (
          <label>About
            <select className="hub-select" value={f.topic} onChange={set("topic")}>
              <option value="attendance">Attendance</option>
              <option value="dialer">Dialer</option>
              <option value="task">Overdue task</option>
              <option value="prospect">Prospect</option>
            </select>
          </label>
        )}
        <label>Day (optional)
          <Input type="date" value={f.dayKey} onChange={set("dayKey")} />
        </label>
        <label>{f.type === "review" ? "Findings and improvement plan" : "Details and evidence"}
          <Input.TextArea rows={4} value={f.message} onChange={set("message")} />
        </label>
      </div>
    </FormModal>
  );
}

export function CasesPanel({ base, people, canManage }) {
  const [rows, setRows] = useState(null);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState(null);
  useEffect(() => {
    let live = true;
    request.get({ entity: `workday/admin/360/cases?${new URLSearchParams(base)}` }).then((r) => live && setRows(r?.success ? r.result : []));
    return () => {
      live = false;
    };
  }, [base, tick]);
  const decide = (c, status) => setAction({ entity: `workday/admin/360/cases/${c._id}/decide`, body: { status }, field: "decision", title: `${status === "accepted" ? "Accept" : status === "rejected" ? "Reject" : "Close"}: ${CASE_TYPE[c.type]}`, subtitle: c.adminName, label: "Decision and reason", ok: "Save decision" });
  return (
    <Panel title={`Disputes, reviews & conduct · ${rows ? rows.length : 0}`} icon={<MessageOutlined />} extra={<button type="button" className="hub-btn" onClick={() => setAdding(true)}>{canManage ? "New case" : "Raise a dispute"}</button>}>
      <div className="hub-table-wrapper">
        <table className="hub-table s3-table">
          <thead><tr><th>Raised</th><th>User</th><th>Type</th><th>Details</th><th>Status</th><th>Decision</th>{canManage && <th />}</tr></thead>
          <tbody>
            {!rows && <tr><td colSpan={7}><div className="s3-skel-rows"><i /><i /></div></td></tr>}
            {rows && !rows.length && <tr><td colSpan={7}><div className="s3-empty">Nothing matches these filters.</div></td></tr>}
            {(rows || []).map((c) => (
              <tr key={c._id}>
                <td style={{ whiteSpace: "nowrap" }}>{when(c.created)}<div className="s3-muted">by {c.raisedByName}</div></td>
                <td>{c.adminName}{c.dayKey && <div className="s3-muted">{dayjs(c.dayKey).format("D MMM YYYY")}</div>}</td>
                <td>{CASE_TYPE[c.type]}<div className="s3-muted">{c.topic}</div></td>
                <td style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>{c.message}</td>
                <td><Pill color={CASE_STATE[c.status][1]}>{CASE_STATE[c.status][0]}</Pill></td>
                <td style={{ maxWidth: 260 }}>{c.decision || "—"}{c.decidedByName && <div className="s3-muted">{c.decidedByName} · {when(c.decidedAt)}</div>}</td>
                {canManage && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    {c.status === "open" && (c.type === "dispute" ? (
                      <>
                        <button type="button" className="s3-link" onClick={() => decide(c, "accepted")}>Accept</button>
                        {" · "}
                        <button type="button" className="s3-link" style={{ color: "#B91C1C" }} onClick={() => decide(c, "rejected")}>Reject</button>
                      </>
                    ) : <button type="button" className="s3-link" onClick={() => decide(c, "closed")}>Close</button>)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="s3-note">Accepting a dispute records the decision; change the day itself with Correct in Attendance by policy.</p>
      <NewCase open={adding} people={people} canManage={canManage} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setTick((x) => x + 1); }} />
      <TextAction action={action} onClose={() => setAction(null)} onSaved={() => { setAction(null); setTick((x) => x + 1); }} />
    </Panel>
  );
}

export function CorrectionsPanel({ base }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    request.get({ entity: `workday/admin/360/corrections?${new URLSearchParams(base)}` }).then((r) => live && setRows(r?.success ? r.result : []));
    return () => {
      live = false;
    };
  }, [base]);
  return (
    <Panel title={`Attendance corrections · ${rows ? rows.length : 0}`} icon={<AuditOutlined />}>
      <div className="hub-table-wrapper">
        <table className="hub-table s3-table">
          <thead><tr><th>Day</th><th>User</th><th>Original</th><th>Revised</th><th>Asked by</th><th>Approved by</th><th>Time</th><th>Reason</th></tr></thead>
          <tbody>
            {!rows && <tr><td colSpan={8}><div className="s3-skel-rows"><i /><i /></div></td></tr>}
            {rows && !rows.length && <tr><td colSpan={8}><div className="s3-empty">No correction in this range.</div></td></tr>}
            {(rows || []).map((c) => (
              <tr key={c._id}>
                <td style={{ whiteSpace: "nowrap" }}>{dayjs(c.dayKey).format("D MMM YYYY")}</td>
                <td>{c.adminName}</td>
                <td>{c.originalStatus}<div className="s3-muted">{c.originalShortLeave || 0} short leave</div></td>
                <td>{c.revisedStatus || "same"}<div className="s3-muted">{c.revisedShortLeave ?? c.originalShortLeave ?? 0} short leave</div></td>
                <td>{c.requestedBy}</td>
                <td>{c.approvedByName}</td>
                <td style={{ whiteSpace: "nowrap" }}>{when(c.created)}</td>
                <td style={{ maxWidth: 300 }}>{c.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const OUTAGE_KIND = { outage: "Technical outage", training: "Approved training", meeting: "Official meeting", emergency: "Emergency" };

export function OutagesPanel({ base, people, canManage }) {
  const [rows, setRows] = useState(null);
  const [tick, setTick] = useState(0);
  const blank = { kind: "outage", from: "", to: "", adminIds: [], reason: "" };
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    request.get({ entity: `workday/admin/360/outages?${new URLSearchParams(base)}` }).then((r) => live && setRows(r?.success ? r.result : []));
    return () => {
      live = false;
    };
  }, [base, tick]);
  const set = (k) => (e) => setForm((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    const r = await request.post({ entity: "workday/admin/360/outages", jsonData: { ...form, from: new Date(form.from).toISOString(), to: new Date(form.to).toISOString() } });
    setBusy(false);
    if (r?.success) {
      setForm(null);
      setTick((x) => x + 1);
    } else message.error(r?.message || "Could not save.");
  };
  const remove = async (o) => {
    const r = await request.post({ entity: `workday/admin/360/outages/${o._id}/remove`, jsonData: {} });
    if (r?.success) setTick((x) => x + 1);
  };
  return (
    <Panel title={`Outages, training & meetings · ${rows ? rows.length : 0}`} icon={<AlertOutlined />} extra={canManage ? <button type="button" className="hub-btn" onClick={() => setForm(blank)}>Log one</button> : null}>
      <div className="hub-table-wrapper">
        <table className="hub-table s3-table">
          <thead><tr><th>Kind</th><th>From</th><th>To</th><th>Who</th><th>Reason</th><th>Logged by</th>{canManage && <th />}</tr></thead>
          <tbody>
            {!rows && <tr><td colSpan={7}><div className="s3-skel-rows"><i /><i /></div></td></tr>}
            {rows && !rows.length && <tr><td colSpan={7}><div className="s3-empty">Nothing logged in this range.</div></td></tr>}
            {(rows || []).map((o) => (
              <tr key={o._id}>
                <td>{OUTAGE_KIND[o.kind]}</td>
                <td style={{ whiteSpace: "nowrap" }}>{when(o.from)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{when(o.to)}</td>
                <td>{(o.adminNames || []).join(", ") || "Everyone"}</td>
                <td style={{ maxWidth: 300 }}>{o.reason}</td>
                <td>{o.byName}</td>
                {canManage && <td><button type="button" className="s3-link" style={{ color: "#B91C1C" }} onClick={() => remove(o)}>Remove</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="s3-note">This time counts as dialer time, and no automatic short leave is recorded for those days.</p>
      {form && (
        <FormModal title="Log an outage, training or meeting" okText="Save" busy={busy} why={!form.from || !form.to ? "Pick the start and end" : form.reason.trim().length < 5 ? "Write the reason" : ""} onOk={save} onClose={() => setForm(null)}>
          <div className="s3p-form">
            <label>Kind
              <select className="hub-select" value={form.kind} onChange={set("kind")}>
                {Object.entries(OUTAGE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label>From
              <Input type="datetime-local" value={form.from} onChange={set("from")} />
            </label>
            <label>To
              <Input type="datetime-local" value={form.to} onChange={set("to")} />
            </label>
            <label>Who (leave empty for everyone)
              <select className="hub-select" multiple style={{ height: 110 }} value={form.adminIds} onChange={(e) => setForm((x) => ({ ...x, adminIds: [...e.target.selectedOptions].map((o) => o.value) }))}>
                {(people || []).map((p) => <option key={p.adminId} value={p.adminId}>{p.name}</option>)}
              </select>
            </label>
            <label>Reason
              <Input.TextArea rows={3} value={form.reason} onChange={set("reason")} />
            </label>
          </div>
        </FormModal>
      )}
    </Panel>
  );
}
