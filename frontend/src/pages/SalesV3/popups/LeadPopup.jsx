import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { message } from "antd";
import { request } from "@/request";
import { dialContact } from "@/pages/Calling/shared";
import { initials, talk, fmtWhen, fmtDay, stageBadge, IST } from "../ui";
import FollowUp from "./FollowUp";
import { cleanResponses } from "@/utils/callResponse";

// v3 design — S3LeadPopup: everything about one number. Opens from any
// number / name anywhere in Sales One Place. Data: GET lead/full-detail?id&phone
// (lead, calls[], callbacks[], totals). Graphs are built from that data only.
const dayKey = (d) => new Date(d).toLocaleDateString("en-CA", IST);
const dayLbl = (k) => new Date(`${k}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function Acc({ k, open, onToggle, icon, title, sub, n, ac, bg, fg, children }) {
  return (
    <div className={open ? "acc open" : "acc"} style={{ "--ac": ac }}>
      <button type="button" className="acc-h" aria-expanded={open} onClick={() => onToggle(k)}>
        <span className="ic" style={{ background: bg, color: fg }}>{icon}</span>
        <span className="tt"><b>{title}</b><span>{sub}</span></span>
        {n !== undefined && <span className="cnt" style={{ background: bg, color: fg }}>{n}</span>}
        <span className="cnt" style={{ background: bg, color: fg }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && <div className="acc-b">{children}</div>}
    </div>
  );
}

export default function LeadPopup({ lead: row, phone: phoneProp, onClose, onAgent }) {
  const id = row && (row.crmLeadId || row.leadId || row._id);
  const phone = (row && row.phone) || phoneProp;
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState({ details: true, calls: true });
  const [follow, setFollow] = useState(false);
  const [dialing, setDialing] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !follow && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, follow]);

  useEffect(() => {
    let gone = false;
    setData(null);
    setErr("");
    const qs = new URLSearchParams();
    if (id) qs.set("id", id);
    if (phone) qs.set("phone", phone);
    request.get({ entity: `lead/full-detail?${qs}` }).then((r) => {
      if (gone) return;
      if (r?.success) setData(r.result);
      else setErr(r?.message || "Could not load the details.");
    });
    return () => {
      gone = true;
    };
  }, [id, phone]);

  const l = (data && data.lead) || row || {};
  const t = data?.totals;
  const calls = data?.calls || [];
  const callbacks = data?.callbacks || [];
  const responses = cleanResponses(Array.isArray(l.callHistory) ? [...l.callHistory].reverse() : []);
  const stages = Array.isArray(l.stageHistory) ? [...l.stageHistory].sort((a, b) => new Date(a.at) - new Date(b.at)) : [];
  const name = l.name || data?.phone || phone || "Lead";
  const shownPhone = l.phone || data?.phone || phone || "";
  const came = l.facebookCreatedAt || l.created;
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  // who spoke to them — per person: calls + talk
  const people = {};
  calls.forEach((c) => {
    if (!c.agentName) return;
    people[c.agentName] = people[c.agentName] || { n: 0, talk: 0 };
    people[c.agentName].n += 1;
    if (c.answered) people[c.agentName].talk += c.talkSeconds || 0;
  });
  // graphs
  const byDay = {};
  calls.forEach((c) => {
    if (!c.at) return;
    const k = dayKey(c.at);
    byDay[k] = byDay[k] || { ok: 0, no: 0 };
    if (c.answered) byDay[k].ok += 1;
    else byDay[k].no += 1;
  });
  const days = Object.keys(byDay).sort().slice(-7);
  const maxDay = Math.max(1, ...days.map((k) => byDay[k].ok + byDay[k].no));
  const spoke = calls.filter((c) => c.answered).length;
  const missed = calls.filter((c) => !c.answered && (c.missedByAgent || c.notPlaced)).length;
  const noAns = calls.length - spoke - missed;
  const talked = calls.filter((c) => c.answered && c.at).sort((a, b) => new Date(a.at) - new Date(b.at)).slice(-7);
  const maxTalk = Math.max(1, ...talked.map((c) => c.talkSeconds || 0));
  const journey = [{ stage: stages[0]?.fromStage || "New Lead", at: came, by: "System" }, ...stages.map((h) => ({ stage: h.toStage, at: h.at, by: h.changedByName }))];

  const fields = [
    ["Source", l.source], ["Form", l.metaFormName], ["Assigned to", l.assignedUserName], ["Team", l.team], ["Email", l.email], ["Alt. phone", l.alternatePhone],
    ["Country", l.country], ["City / state", [l.city, l.state].filter(Boolean).join(", ")], ["Pin code", l.zipcode], ["Persona", l.persona], ["Age", l.age], ["Gender", l.gender],
    ["Highest qualification", l.highestQualification], ["Education", l.education], ["Profile", l.profile], ["Current CTC", l.currentCtc], ["Pain point", l.painPoint],
    ["Preferred language", l.preferredLanguage], ["Budget", l.budgetRange], ["How soon to start", l.howSoonToStart], ["Call back on", l.callBackAt && fmtWhen(l.callBackAt)],
    ["Demo / meeting", l.meetingAt && fmtWhen(l.meetingAt)], ["Future follow-up", l.futureFollowUpAt && fmtDay(l.futureFollowUpAt)], ["Enrolled on", l.enrolledAt && fmtDay(l.enrolledAt)],
    ["Last contact", l.lastContactAt && fmtWhen(l.lastContactAt)], ["Came in", came && fmtWhen(came)],
  ].filter(([, v]) => v);

  const copy = () => navigator.clipboard?.writeText(shownPhone).then(() => message.success("Number copied")).catch(() => {});
  const callNow = async () => {
    setDialing(true);
    const r = await dialContact({ phone: shownPhone, contactName: l.name, callLead: l._id });
    setDialing(false);
    if (r.ok) message.success(r.message || "Calling…");
    else message.error(r.message || "Could not start the call.");
  };

  return createPortal(
    <div className="sv3">
      <div className="lp-ov" role="dialog" aria-modal="true" aria-label="Lead full details" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
        <div className="fd">
          <div className="hd">
            <div className="av2">{initials(l.name)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2>{name}</h2>
              <div className="chps">
                {shownPhone && (
                  <span className="chp">
                    ☎ {shownPhone}
                    <button type="button" className="mi" title="Copy number" aria-label="Copy number" onClick={copy}>⧉</button>
                    <button type="button" className="mi" title="Call this number" aria-label="Call this number" onClick={callNow} disabled={dialing}>☏</button>
                  </span>
                )}
                {l.stage && <span className="chp st">{l.stage}</span>}
                {l.subStatus && <span className="chp">🏷 {l.subStatus}</span>}
                {l.source && <span className="chp">🌐 {l.source}</span>}
                {l.assignedUserName && (
                  <button type="button" className="chp" onClick={() => onAgent?.({ adminId: l.assignedUser?._id || (typeof l.assignedUser === "string" ? l.assignedUser : ""), name: l.assignedUserName })} title="Open this agent’s full day">
                    👤 {l.assignedUserName}
                  </button>
                )}
              </div>
            </div>
            <button type="button" className="ib" onClick={onClose} aria-label="Close">✕</button>
          </div>

          <div className="bdy">
            {err && <div className="state err"><b>{err}</b></div>}
            {!data && !err && <div className="skel" style={{ height: 120 }} />}
            {t && (
              <div className="tls">
                <div className="tl"><span className="ic" style={{ background: "#E8EEFD", color: "#2563EB" }}>☎</span><div><b>{t.calls}</b><span>Calls</span></div></div>
                <div className="tl"><span className="ic" style={{ background: "#E2F5EC", color: "#0B7A55" }}>🎧</span><div><b>{t.connected}{t.calls ? ` · ${Math.round((t.connected / t.calls) * 100)}%` : ""}</b><span>Spoke</span></div></div>
                <div className="tl"><span className="ic" style={{ background: "#EEEAFE", color: "#6D4AE0" }}>🔊</span><div><b>{talk(t.talkSeconds)}</b><span>Total talk time</span></div></div>
                <div className="tl"><span className="ic" style={{ background: "#FEF0E6", color: "#B54708" }}>📅</span><div><b>{t.lastCallAt ? fmtWhen(t.lastCallAt) : "—"}</b><span>Last call</span></div></div>
              </div>
            )}
            {data && (
              <div className="row" style={{ gap: 8, fontSize: 13.5 }}>
                <span className="mut">Who spoke to them (click for their full day):</span>
                {Object.keys(people).length === 0 && <span className="mut">nobody yet</span>}
                {Object.entries(people).map(([n, p]) => (
                  <button key={n} type="button" className="chp" onClick={() => onAgent?.({ name: n })}>
                    <span className="av">{initials(n)}</span>
                    {n} · {p.n} calls · {talk(p.talk)} talk
                  </button>
                ))}
              </div>
            )}

            {data && calls.length > 0 && (
              <div className="g2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))", gap: 12 }}>
                <div className="gbox">
                  <h4>Calls per day <span className="legend"><span><i className="dot" style={{ background: "#0F766E" }} />Spoke</span><span><i className="dot" style={{ background: "#CBD5E1" }} />Not connected</span></span></h4>
                  <div className="cbars" role="img" aria-label="Calls per day">
                    {days.map((k) => (
                      <div key={k} title={`${dayLbl(k)}: ${byDay[k].ok} spoke, ${byDay[k].no} not connected`}>
                        <i style={{ height: `${(byDay[k].no / maxDay) * 100}%`, background: "#CBD5E1" }} />
                        <i style={{ height: `${(byDay[k].ok / maxDay) * 100}%`, background: "#0F766E" }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10, padding: "6px 4px 0" }}>{days.map((k) => <span key={k} style={{ flex: 1, textAlign: "center", fontSize: 11, color: "#5B6B79" }}>{dayLbl(k)}</span>)}</div>
                </div>
                <div className="gbox">
                  <h4>Spoke vs not</h4>
                  <div className="row" style={{ gap: 16, flexWrap: "nowrap" }}>
                    <svg width="116" height="116" viewBox="0 0 42 42" role="img" aria-label={`Spoke ${Math.round((spoke / calls.length) * 100)} percent`}>
                      <circle cx="21" cy="21" r="15.915" fill="none" stroke="#EEF2F6" strokeWidth="6" />
                      {(() => {
                        let acc = 0;
                        return [[spoke, "#0F766E"], [noAns, "#94A3B8"], [missed, "#EA580C"]].map(([n, c], i) => {
                          const p = (n / calls.length) * 100;
                          const el = p > 0 ? <circle key={i} cx="21" cy="21" r="15.915" fill="none" stroke={c} strokeWidth="6" strokeDasharray={`${p} ${100 - p}`} strokeDashoffset={25 - acc} /> : null;
                          acc += p;
                          return el;
                        });
                      })()}
                      <text x="21" y="23.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#0F1E2B" fontFamily="Space Grotesk">{Math.round((spoke / calls.length) * 100)}%</text>
                    </svg>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
                      <span><i className="dot" style={{ background: "#0F766E" }} /> Spoke {spoke}</span>
                      <span><i className="dot" style={{ background: "#94A3B8" }} /> No answer {noAns}</span>
                      <span><i className="dot" style={{ background: "#EA580C" }} /> Missed by agent {missed}</span>
                    </div>
                  </div>
                </div>
                <div className="gbox">
                  <h4>Talk time per call</h4>
                  {talked.length === 0 && <div className="mut" style={{ fontSize: 12.5 }}>No call connected yet.</div>}
                  {talked.map((c, i) => (
                    <div key={`${c.at}-${i}`} className="hb" style={{ gridTemplateColumns: "56px 1fr 44px", padding: "2px 0" }}>
                      <span className="mut" style={{ fontSize: 12 }}>{dayLbl(dayKey(c.at))}</span>
                      <span className="t"><b style={{ width: `${((c.talkSeconds || 0) / maxTalk) * 100}%`, background: "#0F766E" }} /></span>
                      <span className="n" style={{ fontSize: 12 }}>{talk(c.talkSeconds)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data && stages.length > 0 && (
              <div className="gbox">
                <h4>Stage journey</h4>
                <div className="journey">
                  {journey.map((s, i) => (
                    <React.Fragment key={`${s.stage}-${i}`}>
                      {i > 0 && <span className="mut">→</span>}
                      <span className={i === journey.length - 1 ? "stp cur" : "stp"}>
                        {s.stage || "—"}
                        <small>{[s.at && fmtDay(s.at), s.by, i === journey.length - 1 ? "now" : ""].filter(Boolean).join(" · ")}</small>
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {data && (
              <>
                <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                  <button type="button" className="btn sm g" onClick={() => setOpen({ details: true, calls: true, cb: true, resp: true, stage: true })}>Expand all</button>
                  <button type="button" className="btn sm g" onClick={() => setOpen({})}>Collapse all</button>
                </div>
                <Acc k="details" open={!!open.details} onToggle={toggle} icon="▤" title="Details filled in" sub={fields.length ? `${fields.length} fields filled${l.source ? ` · ${l.source}` : ""}` : "Nothing filled in yet"} n={fields.length} ac="#7C6CF0" bg="#EEEAFE" fg="#6D4AE0">
                  {fields.length ? (
                    <div className="f4">{fields.map(([k, v]) => <div key={k}><div className="fk">{k}</div><div className="fv">{String(v)}</div></div>)}</div>
                  ) : (
                    <div className="mut" style={{ marginTop: 10 }}>Nothing filled in yet.</div>
                  )}
                  {(l.message || l.remarks) && (
                    <div className="g2" style={{ marginTop: 12, gap: 12 }}>
                      {l.message && <div><div className="fk">📄 Requirement / message</div><div className="bx">{l.message}</div></div>}
                      {l.remarks && <div><div className="fk">📄 Remarks</div><div className="bx">{l.remarks}</div></div>}
                    </div>
                  )}
                </Acc>
                <Acc k="calls" open={!!open.calls} onToggle={toggle} icon="☎" title="Calls" sub={calls.length ? `${spoke} spoke · ${calls.length - spoke} not connected${t?.lastCallAt ? ` · last ${fmtWhen(t.lastCallAt)}` : ""}` : "No calls to this number yet"} n={calls.length} ac="#2FB37F" bg="#E2F5EC" fg="#0B7A55">
                  {calls.length === 0 && <div className="mut" style={{ marginTop: 10 }}>No calls to this number yet.</div>}
                  {calls.map((c, i) => (
                    <div key={`${c.at}-${i}`} className="itm">
                      <div className="top">
                        <b>{fmtWhen(c.at)}</b>
                        {c.response && <span className="mut">· {c.response}</span>}
                        <span className="sp" />
                        <span className={c.answered ? "b gr" : c.missedByAgent ? "b rd" : "b gy"}>{c.answered ? "Spoke" : c.missedByAgent ? "Missed by agent" : c.notPlaced ? "Not placed" : "Not connected"}</span>
                      </div>
                      <div className="meta">
                        {c.agentName && <span>👤 <button type="button" className="alink" onClick={() => onAgent?.({ name: c.agentName })}>{c.agentName}</button></span>}
                        {c.direction && <span>{c.direction === "inbound" ? "Inbound" : "Outbound"}{c.instantLead ? " · Facebook instant" : ""}</span>}
                        {c.answered && <span>🔊 {talk(c.talkSeconds)} talked</span>}
                        {c.transferredTo && <span>↪ {c.transferredTo}</span>}
                      </div>
                      {c.notes && <div className="bx">{c.notes}</div>}
                      {c.recordingUrl ? (
                        <audio className="sv3-audio" controls preload="none" src={c.recordingUrl} />
                      ) : (
                        <div className="mut" style={{ fontSize: 12, marginTop: 6 }}>No recording for this call.</div>
                      )}
                    </div>
                  ))}
                </Acc>
                {callbacks.length > 0 && (
                  <Acc k="cb" open={!!open.cb} onToggle={toggle} icon="⏱" title="Pending callbacks" sub={`${callbacks.length} due · next ${fmtWhen(callbacks[0].scheduledAt)}`} n={callbacks.length} ac="#E35DA2" bg="#FDE7F3" fg="#BE185D">
                    {callbacks.map((cb) => (
                      <div key={cb._id} className="itm">
                        <div className="top"><b>{fmtWhen(cb.scheduledAt)}</b><span className="sp" /><span className="b or">{cb.status || "Pending"}</span></div>
                        <div className="meta"><span>👤 {cb.assignedAgentName || "—"}</span>{cb.notes && <span>{cb.notes}</span>}</div>
                      </div>
                    ))}
                  </Acc>
                )}
                {responses.length > 0 && (
                  <Acc k="resp" open={!!open.resp} onToggle={toggle} icon="✎" title="Responses saved" sub={`Latest: ${responses[0].outcome || "Response"} · ${responses[0].byName || "—"} · ${fmtWhen(responses[0].at)}`} n={responses.length} ac="#4F7DF0" bg="#E8EEFD" fg="#1D4ED8">
                    {responses.map((r, i) => (
                      <div key={`${r.at}-${i}`} className="itm">
                        <div className="top"><b>{r.outcome || "Response"}</b><span className="sp" />{i === 0 && <span className="b bl">Latest</span>}</div>
                        <div className="meta">{r.byName && <span>👤 {r.byName}</span>}<span>📅 {fmtWhen(r.at)}</span>{r.onCallOf && <span>on call of {r.onCallOf}</span>}</div>
                        {r.notes || r.remarks ? <div className="bx">{r.notes || r.remarks}</div> : <div className="mut" style={{ fontSize: 12, marginTop: 6 }}>No notes written.</div>}
                      </div>
                    ))}
                  </Acc>
                )}
                {stages.length > 0 && (
                  <Acc k="stage" open={!!open.stage} onToggle={toggle} icon="⇄" title="Stage history" sub={journey.map((j) => j.stage).filter(Boolean).slice(-4).join(" → ")} n={stages.length} ac="#E7953A" bg="#FEF0E6" fg="#B54708">
                    {[...stages].reverse().map((h, i) => (
                      <div key={`${h.at}-${i}`} className="itm">
                        <div className="top">
                          <span className={stageBadge(h.toStage)}>{h.toStage || "—"}</span>
                          {h.toSubStatus && <span className="mut">🏷 {h.toSubStatus}</span>}
                          <span className="sp" />
                          {i === 0 && <span className="b bl">Current</span>}
                        </div>
                        <div className="meta"><span>👤 {h.changedByName || "System"}</span><span>📅 {fmtWhen(h.at)}</span>{h.fromStage && <span>from {h.fromStage}{h.fromSubStatus ? ` · ${h.fromSubStatus}` : ""}</span>}</div>
                        {(h.remarks || h.notes) && <div className="bx">{h.remarks || h.notes}</div>}
                      </div>
                    ))}
                  </Acc>
                )}
              </>
            )}
          </div>

          <div className="ftr">
            <span className="sp" />
            <button type="button" className="btn" onClick={() => setFollow(true)} disabled={!shownPhone && !l.email}>Follow-up</button>
            <button type="button" className="btn" onClick={callNow} disabled={!shownPhone || dialing}>{dialing ? "Calling…" : "Call now"}</button>
            <button type="button" className="btn p" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
      {follow && <FollowUp lead={{ name: l.name || name, phone: shownPhone, email: l.email }} onClose={() => setFollow(false)} />}
    </div>,
    document.body
  );
}
