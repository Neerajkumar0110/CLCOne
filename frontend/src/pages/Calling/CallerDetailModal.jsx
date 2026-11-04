import React, { useEffect, useState } from "react";
import HubModal from "@/components/HubModal";
import { request } from "@/request";

// My Calls → click a row: the full lead behind that call (by its number)
// and every call this agent made to it. Backend: GET
// /api/calling/my-calls/:id/detail (leadPool.js myCallDetail).
const Field = ({ label, value }) => (
  <div>
    <div style={{ fontSize: 11, color: "var(--hub-muted)", textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 2, wordBreak: "break-word" }}>{value || "—"}</div>
  </div>
);
const Section = ({ title, children }) => (
  <div>
    <div style={{ fontSize: 11, color: "var(--hub-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 700 }}>{title}</div>
    {children}
  </div>
);
const fmt = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}m ${s % 60}s` : "0s");
const OUTCOME_COLOR = { Connected: "#16a34a", "Not picked up": "#d97706", "Missed by me": "#dc2626" };
const PROSPECT = { pending: ["Waiting for Team Leader verification", "#b45309"], verified: ["Verified", "#16a34a"], rejected: ["Rejected", "#dc2626"] };

// Who raised it, who reviewed it and what came out of the reviewer's call.
function ProspectBlock({ prospect, lead }) {
  const v = prospect.verification;
  const raised = [...(lead.stageHistory || [])].reverse().find((h) => h.toStage === "Prospects");
  const st = PROSPECT[prospect.status];
  return (
    <Section title="Prospect">
      <div className="hub-grid-2" style={{ gap: 12, padding: "10px 12px", border: "1px solid var(--hub-border)", borderRadius: 8 }}>
        <Field label="Status" value={<span style={{ color: st[1] }}>{st[0]}</span>} />
        <Field label="Raised by" value={v?.ownerName || raised?.changedByName} />
        <Field label="Raised on" value={raised ? fmt(raised.at) : null} />
        <Field label="Sent to" value={(lead.prospectHandoffs || []).map((h) => `${h.toName} (${fmt(h.at)})`).join(", ") || "Not sent yet"} />
        {prospect.reviewers?.length > 0 && (
          <Field
            label="Did they talk?"
            value={prospect.reviewers.map((p) => (
              <div key={p.agent} style={{ color: p.connected ? "#15803d" : "#b45309" }}>
                {p.name}: {p.connected ? `talked ${fmtDur(p.talkSec)} · ${fmt(p.lastAt)}` : p.calls ? `${p.calls} call${p.calls === 1 ? "" : "s"}, no answer` : "not called yet"}
              </div>
            ))}
          />
        )}
        <Field label="Why raised" value={raised?.remarks} />
        {v && <Field label="Reviewed by" value={v.byName} />}
        {v && <Field label="Reviewed on" value={fmt(v.at)} />}
        {v && <Field label="Reviewer's outcome" value={v.notes} />}
        {v && <Field label="Reviewer's call" value={v.callFound ? "On record" : "No CRM call found"} />}
        <Field label="Missing details" value={prospect.missing.length ? <span style={{ color: "#b45309" }}>{prospect.missing.join(", ")}</span> : "All filled"} />
      </div>
    </Section>
  );
}

export default function CallerDetailModal({ callId, title, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!callId) return;
    setData(null);
    setErr("");
    request.get({ entity: `calling/my-calls/${callId}/detail` }).then((r) => {
      if (r?.success) setData(r.result);
      else setErr(r?.message || "Could not load this customer.");
    });
  }, [callId]);

  const lead = data?.lead;
  return (
    <HubModal
      open={!!callId}
      onClose={onClose}
      title={lead?.name || title || "Customer"}
      subtitle={lead?.phone || ""}
      width={680}
      footer={<button type="button" className="hub-btn hub-btn-primary" onClick={onClose}>Close</button>}
    >
      {!data && !err && <div className="hub-empty">Loading…</div>}
      {err && <div className="hub-empty">{err}</div>}
      {data && (
        <div className="hub-stack" style={{ gap: 18 }}>
          {!lead && <div className="hub-empty" style={{ padding: 12 }}>No lead in the CRM for this number — only the calls below.</div>}
          {lead && (
            <>
              {data.prospect && <ProspectBlock prospect={data.prospect} lead={lead} />}
              <div className="hub-grid-2" style={{ gap: 12 }}>
                <Field
                  label="Stage"
                  value={
                    <span>
                      {lead.stage}
                      {lead.subStatus && <span style={{ color: "var(--hub-muted)", fontWeight: 500 }}> · {lead.subStatus}</span>}
                    </span>
                  }
                />
                <Field label="Owner" value={lead.assignedUserName || "Unassigned"} />
                <Field label="Phone" value={lead.phone} />
                <Field label="Alt. Phone" value={lead.alternatePhone} />
                <Field label="Email" value={lead.email} />
                <Field label="Source" value={lead.source} />
                <Field label="City / State" value={[lead.city, lead.state].filter(Boolean).join(", ")} />
                <Field label="Team" value={lead.team} />
                <Field label="Persona" value={lead.persona} />
                <Field label="Age" value={lead.age} />
                <Field label="Gender" value={lead.gender} />
                <Field label="Qualification" value={lead.highestQualification} />
                <Field label="Education" value={lead.education} />
                <Field label="Current Profile" value={lead.profile} />
                <Field label="Current CTC" value={lead.currentCtc} />
                <Field label="Pain Point" value={lead.painPoint} />
                <Field label="College / Organisation" value={lead.college} />
                <Field label="Technical Background" value={lead.techBackground} />
                <Field label="Program Interest" value={lead.programInterest} />
                <Field label="Communication Consent" value={lead.consent} />
                <Field label="Language" value={lead.preferredLanguage} />
                <Field label="Budget" value={lead.budgetRange} />
                <Field label="How Soon to Start" value={lead.howSoonToStart} />
                {lead.callBackAt && <Field label="Call Back On" value={fmt(lead.callBackAt)} />}
                {lead.meetingAt && <Field label="Meeting / Demo On" value={fmt(lead.meetingAt)} />}
                {lead.nextFollowUpAt && <Field label="Next Follow-up" value={fmt(lead.nextFollowUpAt)} />}
                {lead.futureFollowUpAt && <Field label="Future Follow-up" value={fmt(lead.futureFollowUpAt)} />}
                {lead.registrationLink && <Field label="Registration Link" value={lead.registrationLink} />}
                {lead.enrolledAt && <Field label="Enrolled On" value={fmt(lead.enrolledAt)} />}
                {lead.metaFormName && <Field label="Facebook Form" value={lead.metaFormName} />}
                {lead.facebookCreatedAt && <Field label="Came in (Facebook)" value={fmt(lead.facebookCreatedAt)} />}
                <Field label="Added to CRM" value={fmt(lead.created)} />
                <Field label="Stage Updated" value={fmt(lead.stageUpdatedAt)} />
              </div>

              {(lead.remarks || lead.message) && (
                <Section title="Notes / Message">
                  <div style={{ fontSize: 13, padding: "10px 12px", background: "var(--hub-bg-soft)", border: "1px solid var(--hub-border)", borderRadius: 8 }}>
                    {lead.remarks || lead.message}
                  </div>
                </Section>
              )}

              {Array.isArray(lead.stageHistory) && lead.stageHistory.length > 0 && (
                <Section title="Stage history">
                  <div style={{ display: "grid", gap: 6, maxHeight: 170, overflowY: "auto" }}>
                    {[...lead.stageHistory].reverse().map((h, i) => (
                      <div key={i} style={{ fontSize: 12.5 }}>
                        <b>{h.fromStage ? `${h.fromStage} → ` : ""}{h.toStage}</b>
                        {h.toSubStatus ? ` · ${h.toSubStatus}` : ""}
                        <span style={{ color: "var(--hub-muted)" }}> · {h.changedByName || "system"} · {fmt(h.at)}</span>
                        {h.remarks && <div style={{ color: "#64748b", fontSize: 12 }}>{h.remarks}</div>}
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}

          <Section title={`${data.shared ? "Calls with this number" : "My calls with this number"} (${data.calls.length})`}>
            <div style={{ display: "grid", gap: 8, maxHeight: 260, overflowY: "auto" }}>
              {data.calls.map((c) => (
                <div key={c._id} style={{ border: "1px solid var(--hub-border)", borderRadius: 10, padding: "8px 12px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12.5 }}>
                    <b style={{ color: OUTCOME_COLOR[c.outcome] || "inherit" }}>{c.outcome}</b>
                    <span>{fmtDur(c.durationSec)}</span>
                    {data.shared && c.agentName && <span style={{ fontWeight: 700 }}>{c.agentName}</span>}
                    {c.disposition && <span className="hub-badge hub-badge-blue">{c.disposition}</span>}
                    <span style={{ color: "var(--hub-muted)", marginLeft: "auto" }}>{fmt(c.at)}</span>
                  </div>
                  {c.notes && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, whiteSpace: "pre-wrap" }}>{c.notes}</div>}
                  {c.recordingUrl && <audio controls preload="none" src={c.recordingUrl} style={{ width: "100%", height: 32, marginTop: 6 }} />}
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </HubModal>
  );
}
