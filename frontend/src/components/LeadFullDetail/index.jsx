import React, { useEffect, useState } from "react";
import HubModal from "@/components/HubModal";
import { request } from "@/request";
import { stageColor, badgeClassForStatus } from "@/config/leadStages";

// One customer, everything about them, in one modal — opened by clicking a
// lead / number row anywhere in the app (Leads tables, Captured Leads,
// called-leads lists, Reports …). Backend: GET /api/lead/full-detail
// (leadController/fullDetail.js) → the lead with every field users filled
// in, every call to the number (who, when, how long they talked, response,
// notes, recording), pending callbacks, totals.
//
//   <LeadFullDetailModal lead={row} onClose={...} />      row with _id / phone
//   <LeadFullDetailModal phone="98…" onClose={...} />     just a number

const fmt = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null);
const talk = (s) => {
  const n = Math.max(0, Math.round(s || 0));
  if (!n) return "0s";
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = n % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
};

const label = { fontSize: 11, color: "var(--hub-muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 600 };
const box = { fontSize: 13, color: "var(--hub-text)", padding: "10px 12px", background: "var(--hub-bg-soft)", border: "1px solid var(--hub-border)", borderRadius: 8 };

function Field({ k, v }) {
  return (
    <div>
      <div style={label}>{k}</div>
      <div style={{ fontSize: 13.5, color: "var(--hub-text)", wordBreak: "break-word" }}>{v || "—"}</div>
    </div>
  );
}

function Section({ title, children, right }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ ...label, fontSize: 11.5, marginBottom: 0 }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Stat({ value, sub, color }) {
  return (
    <div style={{ flex: "1 1 110px", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--hub-border)", background: "var(--hub-bg-soft)" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || "var(--hub-text)" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--hub-muted)" }}>{sub}</div>
    </div>
  );
}

// A name / number in any table that opens the full detail on click — for
// pages that list calls or numbers rather than Lead rows.
//   <LeadLink phone={r.phone}>{r.contactName}</LeadLink>
export function LeadLink({ phone, lead, children }) {
  const [open, setOpen] = useState(false);
  if (!phone && !lead) return children || "—";
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        title="Click for full details"
        style={{ cursor: "pointer", color: "var(--hub-blue)", fontWeight: 600 }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
      >
        {children || phone || "—"}
      </span>
      {open && <LeadFullDetailModal lead={lead} phone={phone} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function LeadFullDetailModal({ lead: row, phone: phoneProp, onClose }) {
  const open = !!(row || phoneProp);
  const id = row && (row.crmLeadId || row.leadId || row._id);
  const phone = (row && row.phone) || phoneProp;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let gone = false;
    setData(null);
    setError(null);
    const qs = new URLSearchParams();
    if (id) qs.set("id", id);
    if (phone) qs.set("phone", phone);
    request.get({ entity: `lead/full-detail?${qs.toString()}` }).then((r) => {
      if (gone) return;
      if (r?.success) setData(r.result);
      else setError(r?.message || "Could not load the details.");
    });
    return () => {
      gone = true;
    };
  }, [open, id, phone]);

  if (!open) return null;

  // Until it loads, show what the row already has.
  const l = (data && data.lead) || row || {};
  const t = data?.totals;
  const extra = [
    ["Email", l.email],
    ["Alt. Phone", l.alternatePhone],
    ["Source", l.source],
    ["Form", l.metaFormName],
    ["Assigned To", l.assignedUserName],
    ["Team", l.team],
    ["City", l.city],
    ["State", l.state],
    ["Country", l.country],
    ["Pin Code", l.zipcode],
    ["Persona", l.persona],
    ["Age", l.age],
    ["Gender", l.gender],
    ["Highest Qualification", l.highestQualification],
    ["Education", l.education],
    ["Profile", l.profile],
    ["Current CTC", l.currentCtc],
    ["Pain Point", l.painPoint],
    ["Preferred Language", l.preferredLanguage],
    ["Budget", l.budgetRange],
    ["How Soon To Start", l.howSoonToStart],
    ["Call Back On", l.callBackAt && fmt(l.callBackAt)],
    ["Demo / Meeting", l.meetingAt && fmt(l.meetingAt)],
    ["Future Follow-up", fmtDay(l.futureFollowUpAt)],
    ["Enrolled On", fmtDay(l.enrolledAt)],
    ["Last Contact", l.lastContactAt && fmt(l.lastContactAt)],
    ["Came In", l.facebookCreatedAt ? fmt(l.facebookCreatedAt) : l.created && fmt(l.created)],
  ];

  return (
    <HubModal
      open
      onClose={onClose}
      title={l.name || (data && data.phone) || phone || "Lead"}
      subtitle={l.phone || phone}
      width={860}
      footer={<button type="button" className="hub-btn hub-btn-primary" onClick={onClose}>Close</button>}
    >
      <div className="hub-stack" style={{ gap: 18 }}>
        {l.stage && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`hub-badge ${badgeClassForStatus(l.stage)}`}>{l.stage}</span>
            {l.subStatus && <span style={{ fontSize: 12.5, color: "var(--hub-muted)" }}>{l.subStatus}</span>}
          </div>
        )}

        {error && <div style={{ ...box, color: "#b91c1c" }}>{error}</div>}
        {!data && !error && <div style={{ fontSize: 13, color: "var(--hub-muted)" }}>Loading calls and details…</div>}

        {t && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Stat value={t.calls} sub="Calls" />
            <Stat value={t.connected} sub="Spoke" color="#16a34a" />
            <Stat value={talk(t.talkSeconds)} sub="Total talk time" color="#2563eb" />
            <Stat value={t.people.length ? t.people.join(", ") : "—"} sub="Who spoke to them" />
            <Stat value={t.lastCallAt ? fmt(t.lastCallAt) : "—"} sub="Last call" />
          </div>
        )}

        <Section title="Details filled in">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
            {extra.filter(([, v]) => v).map(([k, v]) => (
              <Field key={k} k={k} v={v} />
            ))}
          </div>
          {!extra.some(([, v]) => v) && <div style={{ fontSize: 13, color: "var(--hub-muted)" }}>Nothing filled in yet.</div>}
        </Section>

        {(l.message || l.remarks) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {l.message && (
              <div>
                <div style={label}>Requirement / Message</div>
                <div style={box}>{l.message}</div>
              </div>
            )}
            {l.remarks && (
              <div>
                <div style={label}>Remarks</div>
                <div style={box}>{l.remarks}</div>
              </div>
            )}
          </div>
        )}

        {data && (
          <Section title={`Calls (${data.calls.length})`}>
            {data.calls.length ? (
              <div className="hub-table-wrapper" style={{ maxHeight: 340, overflowY: "auto" }}>
                <table className="hub-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>User</th>
                      <th>Result</th>
                      <th>Talked</th>
                      <th>Response</th>
                      <th>Notes</th>
                      <th>Recording</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.calls.map((c) => (
                      <tr key={c._id}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {fmt(c.at)}
                          <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>
                            {c.direction}
                            {c.instantLead ? " · Facebook instant" : ""}
                          </div>
                        </td>
                        <td>{c.agentName || "—"}</td>
                        <td>
                          <span className={`hub-badge ${c.answered ? "hub-badge-green" : "hub-badge-yellow"}`}>
                            {c.answered ? "Spoke" : c.missedByAgent ? "User missed" : "Not picked"}
                          </span>
                          {c.transferredTo && <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>→ {c.transferredTo}</div>}
                        </td>
                        <td style={{ fontWeight: 600 }}>{c.answered ? talk(c.talkSeconds) : "—"}</td>
                        <td>{c.response || "—"}</td>
                        <td style={{ maxWidth: 220, whiteSpace: "pre-wrap" }}>{c.notes || "—"}</td>
                        <td>{c.recordingUrl ? <audio controls preload="none" src={c.recordingUrl} style={{ width: 180, height: 32 }} /> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "var(--hub-muted)" }}>No calls to this number yet.</div>
            )}
          </Section>
        )}

        {data && data.callbacks.length > 0 && (
          <Section title="Pending callbacks">
            <div style={{ display: "grid", gap: 6 }}>
              {data.callbacks.map((cb) => (
                <div key={cb._id} style={{ fontSize: 13 }}>
                  <strong>{fmt(cb.scheduledAt)}</strong> · {cb.assignedAgentName || "—"}
                  {cb.notes ? <span style={{ color: "var(--hub-muted)" }}> — {cb.notes}</span> : null}
                </div>
              ))}
            </div>
          </Section>
        )}

        {Array.isArray(l.callHistory) && l.callHistory.length > 0 && (
          <Section title="Responses saved">
            <div style={{ display: "grid", gap: 6, maxHeight: 180, overflowY: "auto" }}>
              {[...l.callHistory].reverse().map((h, i) => (
                <div key={i} style={{ fontSize: 12.5, color: "var(--hub-text-soft)" }}>
                  <strong>{h.outcome || "Response"}</strong>
                  {h.notes ? <span> — {h.notes}</span> : null}
                  <span style={{ color: "var(--hub-muted)" }}> · {h.byName || "—"} · {fmt(h.at)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {Array.isArray(l.stageHistory) && l.stageHistory.length > 0 && (
          <Section title="Stage history">
            <div style={{ display: "grid", gap: 6, maxHeight: 180, overflowY: "auto" }}>
              {[...l.stageHistory].reverse().map((h, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--hub-text-soft)", display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: stageColor(h.toStage), flexShrink: 0, marginTop: 5 }} />
                  <span style={{ flex: 1 }}>
                    <strong>{h.fromStage ? `${h.fromStage} → ` : ""}{h.toStage}</strong>
                    {h.toSubStatus ? ` · ${h.toSubStatus}` : ""}
                    {h.remarks ? <span style={{ color: "#64748b" }}> — {h.remarks}</span> : ""}
                    <span style={{ color: "var(--hub-muted)" }}> · {h.changedByName || "system"} · {fmt(h.at)}</span>
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </HubModal>
  );
}
