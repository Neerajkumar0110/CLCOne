import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { message } from "antd";
import { request } from "@/request";
import { STAGE_NAMES, stageConfig, subStatusesFor, defaultSubStatus, isValidSubStatus, toDatetimeLocal, toDateInput } from "@/config/leadStages";
import { DEMO_TIME_LABEL, disabledDemoDate, toDemoSlot } from "@/utils/demoDay";
import { Modal } from "../ui";

// v3 design — Leads popups L2 (Add + duplicate), L3 (Edit), L5 (Change owner), L6 (Delete).
// Same APIs and rules as before: POST lead (409 duplicate → "save anyway"
// with allowDuplicate), PATCH lead/:id, POST lead/assign-owner, DELETE lead/:id.
export const SOURCES = ["Manual", "Calling", "Website", "Facebook Ads", "Instagram", "Google Ads", "LinkedIn", "Referral", "Walk-in", "WhatsApp", "Other"];
const COLORS = ["#2563EB", "#722ED1", "#13C2C2", "#FA8C16", "#EB2F96", "#52C41A"];
const fullName = (a) => `${a?.name || ""} ${a?.surname || ""}`.trim() || a?.email || "";

export function pipelineError(form) {
  const cfg = stageConfig(form.stage);
  if (!cfg) return "Pick a lead stage.";
  if (!isValidSubStatus(form.stage, form.subStatus)) return "Pick a sub-status for this stage.";
  if (cfg.requiresCallBack && !form.callBackAt) return `Callback date & time are mandatory for “${form.stage}”.`;
  if (cfg.meetingSubStatuses && cfg.meetingSubStatuses.includes(form.subStatus) && !form.meetingAt) return `Meeting date & time are required for “${form.subStatus}”.`;
  return "";
}

// Stage + sub-status + the dates / link the chosen stage needs + owner, follow-up, notes.
function Pipeline({ form, patch, salesUsers, showReason }) {
  const cfg = stageConfig(form.stage) || {};
  const needMeeting = cfg.meetingSubStatuses && cfg.meetingSubStatuses.includes(form.subStatus);
  const needLink = cfg.linkSubStatuses && cfg.linkSubStatuses.includes(form.subStatus);
  const istDay = (v) => dayjs(new Date(new Date(v).getTime() + 330 * 60000).toISOString().slice(0, 10)).format("YYYY-MM-DD");
  return (
    <>
      <div className="fgrid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        <label className="fld">Stage <span className="req">*</span>
          <select className="sel" value={form.stage} onChange={(e) => patch({ stage: e.target.value, subStatus: defaultSubStatus(e.target.value) })}>
            {STAGE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="fld">Sub-status <span className="req">*</span>
          <select className="sel" value={form.subStatus || ""} onChange={(e) => patch({ subStatus: e.target.value })}>
            {subStatusesFor(form.stage).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {cfg.requiresCallBack && (
          <label className="fld">Callback date &amp; time <span className="req">*</span>
            <input className="in" type="datetime-local" value={toDatetimeLocal(form.callBackAt)} onChange={(e) => patch({ callBackAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          </label>
        )}
        {cfg.meetingSubStatuses && (
          <label className="fld">Live demo day · {DEMO_TIME_LABEL} {needMeeting && <span className="req">*</span>}
            <input
              className="in"
              type="date"
              min={istDay(Date.now())}
              value={form.meetingAt ? istDay(form.meetingAt) : ""}
              onChange={(e) => {
                const v = e.target.value ? dayjs(e.target.value) : null;
                const d = v && disabledDemoDate(v) && v.day() === 0 ? v.add(1, "day") : v;
                patch({ meetingAt: d ? toDemoSlot(d).toISOString() : null });
              }}
            />
          </label>
        )}
        {cfg.capture === "futureFollowUp" && (
          <label className="fld">Expected follow-up date
            <input className="in" type="date" value={toDateInput(form.futureFollowUpAt)} onChange={(e) => patch({ futureFollowUpAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          </label>
        )}
        {cfg.capture === "enrolledAt" && (
          <label className="fld">Registration / enrolment date
            <input className="in" type="date" value={toDateInput(form.enrolledAt)} onChange={(e) => patch({ enrolledAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          </label>
        )}
        {needLink && (
          <>
            <label className="fld">Registration link
              <input className="in" value={form.registrationLink || ""} onChange={(e) => patch({ registrationLink: e.target.value })} placeholder="https://…" />
            </label>
            <label className="fld">Link shared on
              <input className="in" type="date" value={toDateInput(form.registrationLinkSharedAt)} onChange={(e) => patch({ registrationLinkSharedAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </label>
          </>
        )}
        <label className="fld">Owner
          <select className="sel" value={form.assignedUser || ""} onChange={(e) => patch({ assignedUser: e.target.value || null })}>
            <option value="">Unassigned</option>
            {salesUsers.map((a) => <option key={a._id} value={a._id}>{fullName(a)}</option>)}
          </select>
        </label>
        <label className="fld">Next follow-up
          <input className="in" type="datetime-local" value={toDatetimeLocal(form.nextFollowUpAt)} onChange={(e) => patch({ nextFollowUpAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
        </label>
      </div>
      {cfg.description && <div className="mut" style={{ fontSize: 12.5 }}>{cfg.description}</div>}
      {needMeeting && <div className="mut" style={{ fontSize: 12.5 }}>Mon–Sat only (Sunday moves to Monday). The join link is emailed to the customer, you and your Team Leader.</div>}
      <label className="fld">Remarks / notes
        <textarea className="in" rows={3} value={form.remarks || ""} onChange={(e) => patch({ remarks: e.target.value })} />
      </label>
      {showReason && (
        <label className="fld">Reason for this stage change (optional)
          <input className="in" value={form.stageRemarks || ""} onChange={(e) => patch({ stageRemarks: e.target.value })} />
        </label>
      )}
    </>
  );
}

// L2 — Add new lead (+ duplicate warning)
export function AddLead({ onClose, onDone, teamNames, salesUsers }) {
  const [form, setForm] = useState({
    name: "", phone: "", email: "", source: "Manual", team: "", stage: "New Lead", subStatus: defaultSubStatus("New Lead"),
    callBackAt: null, meetingAt: null, futureFollowUpAt: null, enrolledAt: null, nextFollowUpAt: null, registrationLink: "", registrationLinkSharedAt: null, assignedUser: null, remarks: "",
  });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [dup, setDup] = useState(null);
  const patch = (p) => setForm((f) => ({ ...f, ...p }));
  const payload = () => ({ ...form, name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), color: COLORS[Math.floor(Math.random() * COLORS.length)] });
  const save = async (allowDuplicate = false) => {
    if (saving) return;
    if (!form.name.trim()) return setErr("Full name is required.");
    if (String(form.phone).replace(/\D/g, "").length < 10) return setErr("Enter a valid phone number (at least 10 digits).");
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setErr("Enter a valid email address.");
    const p = pipelineError(form);
    if (p) return setErr(p);
    setErr("");
    setSaving(true);
    const r = await request.create({ entity: "lead", jsonData: allowDuplicate ? { ...payload(), allowDuplicate: true } : payload() });
    setSaving(false);
    if (r?.success) {
      onDone?.();
      onClose();
    } else if (r?.duplicate) setDup(r.duplicate);
    else setErr(r?.message || "Could not add the lead.");
  };
  return (
    <Modal
      title="Add new lead"
      sub={<>Fields marked <span className="req">*</span> are required</>}
      onClose={onClose}
      width={720}
      footer={
        <>
          <button type="button" className="btn g" onClick={onClose}>Cancel</button>
          {dup ? (
            <button type="button" className="btn p" disabled={saving} onClick={() => save(true)}>{saving ? "Saving…" : "Save anyway"}</button>
          ) : (
            <button type="button" className="btn p" disabled={saving} onClick={() => save(false)}>{saving ? "Saving…" : "Add lead"}</button>
          )}
        </>
      }
    >
      <div className="fgrid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        <label className="fld">Full name <span className="req">*</span><input className="in" value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Rohan Malhotra" autoFocus /></label>
        <label className="fld">Phone <span className="req">*</span><input className="in" type="tel" value={form.phone} onChange={(e) => { patch({ phone: e.target.value }); setDup(null); }} placeholder="+91 90000 00000" /></label>
        <label className="fld">Email<input className="in" type="email" value={form.email} onChange={(e) => patch({ email: e.target.value })} placeholder="name@example.com" /></label>
        <label className="fld">Source<select className="sel" value={form.source} onChange={(e) => patch({ source: e.target.value })}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="fld">Team<select className="sel" value={form.team} onChange={(e) => patch({ team: e.target.value })}><option value="">No team</option>{teamNames.map((t) => <option key={t}>{t}</option>)}</select></label>
      </div>
      <Pipeline form={form} patch={patch} salesUsers={salesUsers} />
      {!form.assignedUser && form.stage === "New Lead" && <div className="mut" style={{ fontSize: 12.5 }}>No owner + New Lead → it goes to the auto-dialer pool.</div>}
      {dup && (
        <div className="warn">
          <b>Possible duplicate lead.</b> This number already exists{dup.name ? ` as ${dup.name}` : ""}{dup.assignedUserName ? ` (${dup.assignedUserName}` : ""}{dup.stage ? `${dup.assignedUserName ? ", " : " ("}${dup.stage})` : dup.assignedUserName ? ")" : ""}. Save anyway or cancel.
        </div>
      )}
      {err && <div className="emsg">{err}</div>}
    </Modal>
  );
}

// L3 — Edit lead
export function EditLead({ lead, onClose, onDone, teamNames, salesUsers }) {
  const [form, setForm] = useState(() => ({
    name: lead.name || "", phone: lead.phone || "", email: lead.email || "", source: lead.source || "Manual", team: lead.team || "",
    stage: lead.stage || "New Lead", subStatus: lead.subStatus || defaultSubStatus(lead.stage || "New Lead"),
    callBackAt: lead.callBackAt || null, meetingAt: lead.meetingAt || null, futureFollowUpAt: lead.futureFollowUpAt || null, enrolledAt: lead.enrolledAt || null,
    nextFollowUpAt: lead.nextFollowUpAt || null, registrationLink: lead.registrationLink || "", registrationLinkSharedAt: lead.registrationLinkSharedAt || null,
    assignedUser: (lead.assignedUser && (lead.assignedUser._id || lead.assignedUser)) || null, remarks: lead.remarks || "", stageRemarks: "",
  }));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const patch = (p) => setForm((f) => ({ ...f, ...p }));
  const save = async () => {
    if (!form.name.trim()) return setErr("Full name is required.");
    if (String(form.phone).replace(/\D/g, "").length < 10) return setErr("Enter a valid phone number (at least 10 digits).");
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setErr("Enter a valid email address.");
    const p = pipelineError(form);
    if (p) return setErr(p);
    setErr("");
    setSaving(true);
    const owner = salesUsers.find((a) => String(a._id) === String(form.assignedUser));
    const r = await request.update({ entity: "lead", id: lead._id, jsonData: { ...form, name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), ...(owner ? { assignedUserName: fullName(owner) } : {}) } });
    setSaving(false);
    if (r?.success) {
      onDone?.();
      onClose();
    } else setErr(r?.message || "Could not save the lead.");
  };
  return (
    <Modal
      title={`Edit lead — ${lead.name || lead.phone}`}
      sub="Change details, stage or owner"
      onClose={onClose}
      width={720}
      footer={<><button type="button" className="btn g" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button></>}
    >
      <div className="fgrid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        <label className="fld">Full name <span className="req">*</span><input className="in" value={form.name} onChange={(e) => patch({ name: e.target.value })} /></label>
        <label className="fld">Phone <span className="req">*</span><input className="in" type="tel" value={form.phone} onChange={(e) => patch({ phone: e.target.value })} /></label>
        <label className="fld">Email<input className="in" type="email" value={form.email} onChange={(e) => patch({ email: e.target.value })} /></label>
        <label className="fld">Source<select className="sel" value={form.source} onChange={(e) => patch({ source: e.target.value })}>{[...new Set([form.source, ...SOURCES])].filter(Boolean).map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="fld">Team<select className="sel" value={form.team} onChange={(e) => patch({ team: e.target.value })}><option value="">No team</option>{[...new Set([form.team, ...teamNames])].filter(Boolean).map((t) => <option key={t}>{t}</option>)}</select></label>
      </div>
      <Pipeline form={form} patch={patch} salesUsers={salesUsers} showReason={form.stage !== lead.stage} />
      {err && <div className="emsg">{err}</div>}
    </Modal>
  );
}

// L5 — Change owner (ticked leads, or every lead in the current list)
export function ChangeOwner({ leadIds = [], single, viewFilter, total, salesUsers, onClose, onDone }) {
  const [target, setTarget] = useState(leadIds.length ? "selected" : "all");
  const [picked, setPicked] = useState([]);
  const [mode, setMode] = useState("equal");
  const [unassign, setUnassign] = useState(false);
  const [limit, setLimit] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const scope = single ? 1 : target === "selected" ? leadIds.length : Math.min(total || 0, Number(limit) || Infinity);
  const toggle = (id) => {
    if (single) return setPicked([{ userId: id, count: 1 }]);
    setPicked((l) => (l.some((p) => p.userId === id) ? l.filter((p) => p.userId !== id) : [...l, { userId: id, count: "" }]));
  };
  const preview = useMemo(() => {
    if (unassign || !picked.length || !scope) return [];
    if (mode === "custom") return picked.map((p) => ({ ...p, n: Number(p.count) || 0 }));
    const per = Math.floor(scope / picked.length);
    const extra = scope % picked.length;
    return picked.map((p, i) => ({ ...p, n: per + (i < extra ? 1 : 0) }));
  }, [picked, mode, scope, unassign]);
  const shown = salesUsers.filter((a) => !q || `${fullName(a)} ${a.email} ${a.role}`.toLowerCase().includes(q.toLowerCase()));
  const submit = async () => {
    if (saving) return;
    setErr("");
    if (!scope) return setErr("No leads to assign.");
    if (!unassign && !picked.length) return setErr("Pick at least one owner.");
    if (!unassign && mode === "custom" && picked.some((p) => !(Number(p.count) > 0))) return setErr("Enter how many leads each picked owner gets.");
    const body = {
      ...(single ? { leadIds: [single._id] } : target === "selected" ? { leadIds } : { filter: viewFilter, ...(Number(limit) ? { limit: Number(limit) } : {}) }),
      unassign,
      mode: single ? "equal" : mode,
      owners: picked.map((p) => ({ userId: p.userId, count: Number(p.count) || 0 })),
    };
    setSaving(true);
    const r = await request.post({ entity: "lead/assign-owner", jsonData: body });
    setSaving(false);
    if (r?.success) {
      message.success(r.message);
      onDone?.();
      onClose();
    } else setErr(r?.message || "Could not change the owner.");
  };
  return (
    <Modal
      title={single ? `Change owner — ${single.name || "lead"}` : "Change owner"}
      sub={single ? `Now: ${single.assignedUserName || "Unassigned"}` : `${scope || 0} lead(s) in scope`}
      onClose={onClose}
      width={620}
      footer={<><button type="button" className="btn g" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={saving} onClick={submit}>{saving ? "Saving…" : unassign ? "Remove owner" : "Give leads"}</button></>}
    >
      {!single && (
        <div className="row">
          <div className="seg" role="group" aria-label="Which leads">
            <button type="button" className={target === "selected" ? "on" : ""} disabled={!leadIds.length} onClick={() => setTarget("selected")}>Ticked · {leadIds.length}</button>
            <button type="button" className={target === "all" ? "on" : ""} onClick={() => setTarget("all")}>Everyone in this list · {total || 0}</button>
          </div>
          {target === "all" && <label className="fld" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>Only the first<input className="in" style={{ width: 90 }} value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} placeholder="all" /></label>}
        </div>
      )}
      <label className="row" style={{ gap: 8, fontSize: 13.5 }}><input type="checkbox" checked={unassign} onChange={(e) => setUnassign(e.target.checked)} /> Remove the owner instead (leave unassigned)</label>
      {!unassign && (
        <>
          {!single && (
            <div className="seg" role="group" aria-label="Split">
              <button type="button" className={mode === "equal" ? "on" : ""} onClick={() => setMode("equal")}>Split equally</button>
              <button type="button" className={mode === "custom" ? "on" : ""} onClick={() => setMode("custom")}>Custom counts</button>
            </div>
          )}
          <label className="srch" style={{ flex: "none" }}><input type="search" placeholder="Search Sales users…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Sales users" /></label>
          <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #E2E8F0", borderRadius: 10 }}>
            {shown.map((a) => {
              const p = picked.find((x) => x.userId === a._id);
              const pv = preview.find((x) => x.userId === a._id);
              return (
                <div key={a._id} className="row" style={{ padding: "8px 12px", borderBottom: "1px solid #EEF2F6", gap: 10 }}>
                  <label className="row" style={{ gap: 8, flex: 1 }}>
                    <input type={single ? "radio" : "checkbox"} checked={!!p} onChange={() => toggle(a._id)} />
                    <span className="who"><span className="av">{fullName(a).slice(0, 2).toUpperCase()}</span><span><b>{fullName(a)}</b><div className="mut" style={{ fontSize: 12 }}>{a.role}</div></span></span>
                  </label>
                  {p && mode === "custom" && !single && <input className="in" style={{ width: 80 }} value={p.count} onChange={(e) => setPicked((l) => l.map((x) => (x.userId === a._id ? { ...x, count: e.target.value.replace(/\D/g, "") } : x)))} placeholder="count" />}
                  {pv && <span className="b tl">{pv.n} lead{pv.n === 1 ? "" : "s"}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
      {err && <div className="emsg">{err}</div>}
    </Modal>
  );
}

// L6 — Delete lead(s)
export function DeleteLeads({ leads, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true);
    const res = await Promise.allSettled(leads.map((l) => request.delete({ entity: "lead", id: l._id })));
    const ok = res.filter((r) => r.status === "fulfilled" && r.value?.success !== false).length;
    setBusy(false);
    if (ok < leads.length) message.warning(`${ok} deleted · ${leads.length - ok} failed`);
    else message.success(`${ok} lead${ok === 1 ? "" : "s"} deleted`);
    onDone?.();
    onClose();
  };
  return (
    <Modal
      title={leads.length === 1 ? `Delete ${leads[0].name || "this lead"}?` : `Delete ${leads.length} leads?`}
      sub="This cannot be undone"
      onClose={onClose}
      width={460}
      footer={<><button type="button" className="btn g" onClick={onClose}>Cancel</button><button type="button" className="btn d" disabled={busy} onClick={del}>{busy ? "Deleting…" : "Delete"}</button></>}
    >
      <div className="warn">The lead, its stage history and responses are removed. Call records stay in Call History.</div>
    </Modal>
  );
}

export function useSalesSetup() {
  const [admins, setAdmins] = useState([]);
  const [teams, setTeams] = useState([]);
  useEffect(() => {
    request.list({ entity: "admin", options: { items: 500 } }).then((r) => setAdmins(r?.success ? r.result : []));
    request.listAll({ entity: "team" }).then((r) => setTeams(r?.success ? r.result : []));
  }, []);
  return { admins, teams, teamNames: teams.map((t) => t.name) };
}
export { fullName };
