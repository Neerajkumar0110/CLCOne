import React, { useEffect, useMemo, useState } from "react";
import { request } from "@/request";
import { Modal, fmtWhen, talk } from "../ui";

// v3 design — call popups C2 (Caller details), C3 (Send for verification),
// C4 (Pool stages). Same APIs as before:
//   GET  calling/my-calls/:id/detail, GET calling/prospect-recipients,
//   POST calling/my-calls/:id/send-prospect {to, note},
//   GET  calling/lead-pool/stage-stats, POST calling/lead-pool/stage {stages}.
const OUTCOME_B = { Connected: "b gr", "Not picked up": "b or", "Missed by me": "b rd" };
const PROSPECT = { pending: ["Waiting for Team Leader verification", "b or"], verified: ["Verified", "b gr"], rejected: ["Rejected", "b rd"] };
const ROLE_ORDER = ["Team Leader", "Team Manager", "Sales Manager", "Admin", "Super Admin", "owner"];
const F = ({ k, v }) => (
  <div>
    <div className="fk">{k}</div>
    <div className="fv">{v || "—"}</div>
  </div>
);

function CallItem({ c, shared }) {
  return (
    <div className="itm">
      <div className="top">
        <span className={OUTCOME_B[c.outcome] || "b gy"}>{c.outcome}</span>
        <span>{talk(c.durationSec)}</span>
        {shared && c.agentName && <b>{c.agentName}</b>}
        {c.disposition && <span className="b bl">{c.disposition}</span>}
        <span className="sp" />
        <span className="mut">{fmtWhen(c.at)}</span>
      </div>
      {c.notes && <div className="bx">{c.notes}</div>}
      {c.recordingUrl && <audio className="sv3-audio" controls preload="none" src={c.recordingUrl} aria-label="Call recording" />}
    </div>
  );
}

// C2 — Caller details (28 fields + prospect + missing details + calls)
export function CallerDetail({ callId, title, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    request.get({ entity: `calling/my-calls/${callId}/detail` }).then((r) => {
      if (r?.success) setD(r.result);
      else setErr(r?.message || "Could not load this customer.");
    });
  }, [callId]);
  const l = d?.lead;
  const raised = l ? [...(l.stageHistory || [])].reverse().find((h) => h.toStage === "Prospects") : null;
  const p = d?.prospect;
  const fields = l
    ? [
        ["Stage", `${l.stage || "—"}${l.subStatus ? ` · ${l.subStatus}` : ""}`], ["Owner", l.assignedUserName || "Unassigned"], ["Phone", l.phone], ["Alt. phone", l.alternatePhone],
        ["Email", l.email], ["Source", l.source], ["City / state", [l.city, l.state].filter(Boolean).join(", ")], ["Team", l.team], ["Persona", l.persona], ["Age", l.age],
        ["Gender", l.gender], ["Qualification", l.highestQualification], ["Education", l.education], ["Current profile", l.profile], ["Current CTC", l.currentCtc],
        ["Pain point", l.painPoint], ["College / organisation", l.college], ["Technical background", l.techBackground], ["Program interest", l.programInterest],
        ["Communication consent", l.consent], ["Language", l.preferredLanguage], ["Budget", l.budgetRange], ["How soon to start", l.howSoonToStart],
        l.callBackAt && ["Call back on", fmtWhen(l.callBackAt)], l.meetingAt && ["Meeting / demo on", fmtWhen(l.meetingAt)], l.nextFollowUpAt && ["Next follow-up", fmtWhen(l.nextFollowUpAt)],
        l.futureFollowUpAt && ["Future follow-up", fmtWhen(l.futureFollowUpAt)], l.registrationLink && ["Registration link", l.registrationLink], l.enrolledAt && ["Enrolled on", fmtWhen(l.enrolledAt)],
        l.metaFormName && ["Facebook form", l.metaFormName], l.facebookCreatedAt && ["Came in (Facebook)", fmtWhen(l.facebookCreatedAt)], ["Added to CRM", fmtWhen(l.created)], ["Stage updated", fmtWhen(l.stageUpdatedAt)],
      ].filter(Boolean)
    : [];
  return (
    <Modal title={l?.name || title || "Customer"} sub={l?.phone || ""} onClose={onClose} width={760} footer={<button type="button" className="btn p" onClick={onClose}>Close</button>}>
      {!d && !err && <div className="skel" style={{ height: 200 }} />}
      {err && <div className="state err"><b>{err}</b></div>}
      {d && !l && <div className="state"><b>No lead in the CRM for this number — only the calls below.</b></div>}
      {p && l && (
        <div className="gbox">
          <h4>Prospect <span className={PROSPECT[p.status]?.[1] || "b gy"}>{PROSPECT[p.status]?.[0] || p.status}</span></h4>
          <div className="f4" style={{ marginTop: 0 }}>
            <F k="Raised by" v={p.verification?.ownerName || raised?.changedByName} />
            <F k="Raised on" v={raised ? fmtWhen(raised.at) : null} />
            <F k="Sent to" v={(l.prospectHandoffs || []).map((h) => `${h.toName} (${fmtWhen(h.at)})`).join(", ") || "Not sent yet"} />
            <F k="Why raised" v={raised?.remarks} />
            {p.verification && <F k="Reviewed by" v={p.verification.byName} />}
            {p.verification && <F k="Reviewed on" v={fmtWhen(p.verification.at)} />}
            {p.verification && <F k="Reviewer's outcome" v={p.verification.notes} />}
            {p.verification && <F k="Reviewer's call" v={p.verification.callFound ? "On record" : "No CRM call found"} />}
            <F k="Missing details" v={p.missing?.length ? <span style={{ color: "#B54708" }}>{p.missing.join(", ")}</span> : "All filled"} />
          </div>
          {(p.reviewers || []).length > 0 && (
            <div className="mut" style={{ fontSize: 12.5, marginTop: 8 }}>
              Did they talk? {p.reviewers.map((r) => `${r.name}: ${r.connected ? `talked ${talk(r.talkSec)} · ${fmtWhen(r.lastAt)}` : r.calls ? `${r.calls} call(s), no answer` : "not called yet"}`).join(" · ")}
            </div>
          )}
        </div>
      )}
      {l && <div className="f4">{fields.map(([k, v]) => <F key={k} k={k} v={v} />)}</div>}
      {l && (l.remarks || l.message) && <div><div className="fk">Notes / message</div><div className="bx">{l.remarks || l.message}</div></div>}
      {l && (l.stageHistory || []).length > 0 && (
        <div>
          <div className="fk">Stage history</div>
          {[...l.stageHistory].reverse().map((h, i) => (
            <div key={i} className="itm">
              <div className="top"><b>{h.fromStage ? `${h.fromStage} → ` : ""}{h.toStage}</b>{h.toSubStatus && <span className="mut">· {h.toSubStatus}</span>}<span className="sp" /><span className="mut">{h.changedByName || "system"} · {fmtWhen(h.at)}</span></div>
              {h.remarks && <div className="mut" style={{ fontSize: 12, marginTop: 4 }}>{h.remarks}</div>}
            </div>
          ))}
        </div>
      )}
      {d && (
        <div>
          <div className="fk">{d.shared ? "Calls with this number" : "My calls with this number"} ({d.calls.length})</div>
          {d.calls.map((c) => <CallItem key={c._id} c={c} shared={d.shared} />)}
        </div>
      )}
    </Modal>
  );
}

// C3 — Send for verification (pick reviewers, add a note)
export function SendProspect({ call, onClose, onSent }) {
  const [d, setD] = useState(null);
  const [people, setPeople] = useState(null);
  const [picked, setPicked] = useState([]);
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    request.get({ entity: `calling/my-calls/${call.id}/detail` }).then((r) => (r?.success ? setD(r.result) : setErr(r?.message || "Could not load this prospect.")));
    request.get({ entity: "calling/prospect-recipients" }).then((r) => setPeople(r?.success ? r.result : []));
  }, [call.id]);
  const l = d?.lead;
  const sentTo = useMemo(() => new Map((l?.prospectHandoffs || []).map((h) => [String(h.to), h])), [l]);
  const roles = ROLE_ORDER.filter((x) => (people || []).some((p) => p.role === x));
  const shown = (people || []).filter((p) => (!role || p.role === role) && p.name.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name));
  const calls = d?.calls || [];
  const conn = calls.filter((c) => c.outcome === "Connected");
  const story = [...calls.map((c) => ({ key: `c${c._id}`, at: c.at, c })), ...(l?.stageHistory || []).map((h, i) => ({ key: `h${i}`, at: h.at, h }))].sort((a, b) => new Date(b.at) - new Date(a.at));
  const blocked = d && d.prospect?.status !== "pending";
  const send = async () => {
    setBusy(true);
    setErr("");
    const r = await request.post({ entity: `calling/my-calls/${call.id}/send-prospect`, jsonData: { to: picked, note } });
    setBusy(false);
    if (r?.success) onSent?.();
    else setErr(r?.message || "Could not send.");
  };
  return (
    <Modal
      title={`Send for verification · ${l?.name || call.name || ""}`}
      sub={l?.phone || ""}
      onClose={onClose}
      width={980}
      footer={
        <>
          <button type="button" className="btn g" onClick={onClose}>Cancel</button>
          <button type="button" className="btn p" disabled={busy || !picked.length || blocked} onClick={send}>
            {busy ? "Sending…" : picked.length ? `Send to ${picked.length} ${picked.length === 1 ? "person" : "people"}` : "Pick who to send to"}
          </button>
        </>
      }
    >
      {!d && !err && <div className="skel" style={{ height: 200 }} />}
      {err && <div className="state err"><b>{err}</b></div>}
      {blocked && <div className="warn">This lead is not waiting for verification any more ({d.prospect?.status || "not a prospect"}).</div>}
      {d && (
        <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
          <div style={{ flex: "999 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="tls">
              <div className="tl"><div><b>{calls.length}</b><span>Calls</span></div></div>
              <div className="tl"><div><b>{conn.length}</b><span>Connected</span></div></div>
              <div className="tl"><div><b>{talk(conn.reduce((t, c) => t + c.durationSec, 0))}</b><span>Total talk</span></div></div>
              <div className="tl"><div><b>{calls[0] ? fmtWhen(calls[0].at) : "—"}</b><span>Last call</span></div></div>
            </div>
            {d.prospect?.missing?.length > 0 && <div className="warn">Still missing: {d.prospect.missing.join(", ")}. The reviewer will see this.</div>}
            <div><div className="fk">Lead</div><div style={{ fontSize: 13, lineHeight: 1.7 }}>{[l?.city, l?.persona, l?.education, l?.profile, l?.painPoint, l?.budgetRange, l?.howSoonToStart].filter(Boolean).join(" · ") || "No details filled yet"}{l?.remarks && <div className="mut">{l.remarks}</div>}</div></div>
            <div>
              <div className="fk">Calls and what was said</div>
              <div style={{ maxHeight: 340, overflow: "auto" }}>
                {story.map((x) => (x.c ? <CallItem key={x.key} c={x.c} shared={d.shared} /> : (
                  <div key={x.key} className="itm" style={{ background: "#F5F7FA" }}>
                    <div className="top"><b>{x.h.toStage}{x.h.toSubStatus && x.h.toSubStatus !== x.h.toStage ? ` · ${x.h.toSubStatus}` : ""}</b><span className="sp" /><span className="mut">{x.h.changedByName || "system"} · {fmtWhen(x.h.at)}</span></div>
                    {x.h.remarks && <div style={{ fontSize: 12.5, marginTop: 4 }}>{x.h.remarks}</div>}
                  </div>
                )))}
                {!story.length && <div className="mut">No calls yet.</div>}
              </div>
            </div>
          </div>
          <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="fld">Send to<input className="in" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" /></label>
            <div className="seg" role="group" aria-label="Role">
              {[["", "All"], ...roles.map((x) => [x, x])].map(([k, lb]) => <button key={k || "all"} type="button" className={role === k ? "on" : ""} onClick={() => setRole(k)}>{lb}</button>)}
            </div>
            <div style={{ maxHeight: 250, overflow: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              {!people && <div className="skel" style={{ height: 120 }} />}
              {people && !shown.length && <div className="mut">Nobody found.</div>}
              {shown.map((p) => {
                const done = sentTo.get(String(p._id));
                return (
                  <label key={p._id} className="row" style={{ gap: 10, minHeight: 44, padding: "4px 10px", borderRadius: 10, border: "1px solid #E2E8F0", flexWrap: "nowrap", cursor: done ? "default" : "pointer" }}>
                    <input type="checkbox" disabled={!!done} checked={!!done || picked.includes(p._id)} onChange={() => setPicked((x) => (x.includes(p._id) ? x.filter((y) => y !== p._id) : [...x, p._id]))} />
                    <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", fontSize: 13 }}>{p.name}</b><span className="mut" style={{ fontSize: 11.5 }}>{done ? `Sent ${fmtWhen(done.at)}` : p.role}</span></span>
                  </label>
                );
              })}
            </div>
            <label className="fld">Your note (optional)<textarea className="in" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
            <div className="mut" style={{ fontSize: 12 }}>They get a CRM notification and an email with all the calls and notes.</div>
          </div>
        </div>
      )}
      {err && d && <div className="emsg">{err}</div>}
    </Modal>
  );
}

// C4 — Pool stages: New Lead always #1, then up to `max` stages in order.
const FRESH = "New Lead";
const RESULT_LABEL = { connected: "connected", notpicked: "not picked", missed: "missed", failed: "failed" };
export function PoolStages({ options = [], current = [], max = 5, onClose, onSave, saving }) {
  const opts = options.filter((s) => s !== FRESH);
  const [picked, setPicked] = useState(current.filter((s) => s !== FRESH));
  const [stats, setStats] = useState({});
  const [auto, setAuto] = useState(null);
  useEffect(() => {
    request.get({ entity: "calling/lead-pool/stage-stats" }).then((r) => {
      if (r?.success) {
        setStats(Object.fromEntries((r.result?.stages || []).map((x) => [x.stage, x])));
        setAuto(r.result?.autoPicked || null);
      }
    });
  }, []);
  const line = (st) => {
    if (!st) return null;
    if (!st.order) return <span className="mut" style={{ fontSize: 12 }}>{st.available} leads to dial</span>;
    const res = Object.entries(st.results || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${RESULT_LABEL[k] || k}`).join(" · ");
    return (
      <span className="mut" style={{ fontSize: 12 }}>
        {st.finished ? <b style={{ color: "#0B7A55" }}>✓ Finished</b> : st.active ? <b style={{ color: "#1D4ED8" }}>● Dialing now</b> : <b>Waiting</b>} · {st.dialed} dialed · {st.left} left{res ? ` · ${res}` : ""}
      </span>
    );
  };
  const move = (i, dlt) => setPicked((p) => {
    const j = i + dlt;
    if (j < 0 || j >= p.length) return p;
    const n = [...p];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const same = picked.length === current.filter((s) => s !== FRESH).length && picked.every((s, i) => s === current.filter((x) => x !== FRESH)[i]);
  return (
    <Modal
      title="Stages dialled, in order"
      sub={`New Leads always dial first. Then up to ${max} stages — each dials when the one above runs out.`}
      onClose={onClose}
      width={620}
      footer={<><button type="button" className="btn g" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={saving || same} onClick={() => onSave(picked)}>{saving ? "Saving…" : "Save order"}</button></>}
    >
      {auto && <div className="ok">The pool set this order itself: {Array.isArray(auto) ? auto.join(" → ") : String(auto)}</div>}
      <div className="fk">Order ({picked.length}/{max} + New Lead)</div>
      <div className="itm" style={{ background: "#F0FAF8" }}>
        <div className="top"><span className="b tl">1 · {FRESH}</span><span className="mut" style={{ fontSize: 12 }}>always first · can’t be removed</span><span className="sp" />{line(stats[FRESH])}</div>
      </div>
      {picked.map((s, i) => (
        <div key={s} className="itm">
          <div className="top">
            <span className="b gy">{i + 2} · {s}</span>
            <span className="sp" />
            <button type="button" className="ib" aria-label={`Move ${s} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="ib" aria-label={`Move ${s} down`} disabled={i === picked.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="ib" aria-label={`Remove ${s}`} onClick={() => setPicked((p) => p.filter((x) => x !== s))}>✕</button>
          </div>
          <div style={{ marginTop: 4 }}>{line(stats[s])}</div>
        </div>
      ))}
      <div className="fk">Add a stage {picked.length >= max ? `(max ${max} reached)` : ""}</div>
      <div className="row" style={{ gap: 6 }}>
        {opts.filter((s) => !picked.includes(s)).map((s) => (
          <button key={s} type="button" className="pill" disabled={picked.length >= max} style={{ opacity: picked.length >= max ? 0.5 : 1 }} onClick={() => setPicked((p) => (p.length >= max ? p : [...p, s]))}>
            + {s}{stats[s]?.available != null ? ` · ${stats[s].available}` : ""}
          </button>
        ))}
      </div>
      <div className="mut" style={{ fontSize: 12 }}>New Lead dials every New Lead with a phone. If new leads land in an earlier stage, the pool goes back to it first.</div>
    </Modal>
  );
}
