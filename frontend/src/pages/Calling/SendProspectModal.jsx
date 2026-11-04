import React, { useEffect, useMemo, useState } from "react";
import HubModal from "@/components/HubModal";
import { request } from "@/request";

// My Calls → Send: hand a prospect to a reviewer. On the left the whole story
// that goes with it (every call, how long, what was said); on the right who
// gets it. Backend: callingController/prospectSend.js.
const fmt = (d) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const dur = (s) => (s ? `${Math.floor(s / 60)}m ${s % 60}s` : "0s");
const ROLE_ORDER = ["Team Leader", "Team Manager", "Sales Manager", "Admin", "Super Admin", "owner"];
const OUTCOME_COLOR = { Connected: "#15803d", "Not picked up": "#b45309", "Missed by me": "#b91c1c" };

const Label = ({ children }) => <div style={{ fontSize: 11, color: "var(--hub-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 700 }}>{children}</div>;
const Tile = ({ value, label }) => (
  <div style={{ padding: "10px 12px", border: "1px solid var(--hub-border)", borderRadius: 10 }}>
    <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--hub-muted)" }}>{label}</div>
  </div>
);

export default function SendProspectModal({ call, onClose, onSent }) {
  const [detail, setDetail] = useState(null);
  const [people, setPeople] = useState(null);
  const [picked, setPicked] = useState([]);
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const callId = call?.id;

  useEffect(() => {
    if (!callId) return;
    setDetail(null);
    setPicked([]);
    setNote("");
    setRole("");
    setQ("");
    setErr("");
    request.get({ entity: `calling/my-calls/${callId}/detail` }).then((r) => {
      if (r?.success) setDetail(r.result);
      else setErr(r?.message || "Could not load this prospect.");
    });
    request.get({ entity: "calling/prospect-recipients" }).then((r) => setPeople(r?.success ? r.result : []));
  }, [callId]);

  const lead = detail?.lead;
  const sentTo = useMemo(() => new Map((lead?.prospectHandoffs || []).map((h) => [String(h.to), h])), [lead]);
  const roles = useMemo(() => ROLE_ORDER.filter((x) => (people || []).some((p) => p.role === x)), [people]);
  const shown = (people || [])
    .filter((p) => (!role || p.role === role) && p.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name));
  const toggle = (id) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  const calls = detail?.calls || [];
  const connected = calls.filter((c) => c.outcome === "Connected");
  const talk = connected.reduce((t, c) => t + c.durationSec, 0);
  // Calls and saved remarks in one list, newest first: what was said, and when.
  const story = [
    ...calls.map((c) => ({ key: `c${c._id}`, at: c.at, call: c })),
    ...(lead?.stageHistory || []).map((h, i) => ({ key: `h${i}`, at: h.at, stage: h })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const send = async () => {
    setBusy(true);
    setErr("");
    const r = await request.post({ entity: `calling/my-calls/${callId}/send-prospect`, jsonData: { to: picked, note } });
    setBusy(false);
    if (r?.success) onSent();
    else setErr(r?.message || "Could not send.");
  };

  const blocked = detail && detail.prospect?.status !== "pending";
  return (
    <HubModal
      open={!!callId}
      onClose={onClose}
      title={`Send prospect · ${lead?.name || call?.name || ""}`}
      subtitle={lead?.phone || ""}
      width={960}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="hub-btn hub-btn-primary" disabled={busy || !picked.length || blocked} onClick={send}>
            {busy ? "Sending…" : picked.length ? `Send to ${picked.length} ${picked.length === 1 ? "person" : "people"}` : "Pick who to send to"}
          </button>
        </>
      }
    >
      {!detail && !err && <div className="hub-empty">Loading…</div>}
      {err && <div className="hub-empty" role="alert" style={{ color: "#b91c1c" }}>{err}</div>}
      {detail && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
          <div style={{ flex: "999 1 420px", minWidth: 0, display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
              <Tile value={calls.length} label="Calls" />
              <Tile value={connected.length} label="Connected" />
              <Tile value={dur(talk)} label="Total talk" />
              <Tile value={calls[0] ? fmt(calls[0].at) : "—"} label="Last call" />
            </div>
            {detail.prospect?.missing?.length > 0 && (
              <div style={{ fontSize: 12.5, fontWeight: 600, padding: "8px 12px", borderRadius: 8, background: "#fef3c7", color: "#78350f" }}>
                Still missing: {detail.prospect.missing.join(", ")}. The reviewer will see this.
              </div>
            )}
            <div>
              <Label>Lead</Label>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                {[lead?.city, lead?.persona, lead?.education, lead?.profile, lead?.painPoint, lead?.budgetRange, lead?.howSoonToStart].filter(Boolean).join(" · ") || "No details filled yet"}
                {lead?.remarks && <div style={{ color: "#475569" }}>{lead.remarks}</div>}
              </div>
            </div>
            <div>
              <Label>Calls and what was said</Label>
              <div style={{ display: "grid", gap: 8, maxHeight: 340, overflowY: "auto", paddingRight: 4 }}>
                {story.map((x) =>
                  x.call ? (
                    <div key={x.key} style={{ border: "1px solid var(--hub-border)", borderRadius: 10, padding: "8px 12px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12.5 }}>
                        <b style={{ color: OUTCOME_COLOR[x.call.outcome] || "inherit" }}>{x.call.outcome}</b>
                        <span>{dur(x.call.durationSec)}</span>
                        {detail.shared && x.call.agentName && <b>{x.call.agentName}</b>}
                        {x.call.disposition && <span className="hub-badge hub-badge-blue">{x.call.disposition}</span>}
                        <span style={{ color: "var(--hub-muted)", marginLeft: "auto" }}>{fmt(x.call.at)}</span>
                      </div>
                      {x.call.notes && <div style={{ fontSize: 12.5, marginTop: 4, whiteSpace: "pre-wrap" }}>{x.call.notes}</div>}
                      {x.call.recordingUrl && <audio controls preload="none" src={x.call.recordingUrl} aria-label="Call recording" style={{ width: "100%", height: 32, marginTop: 6 }} />}
                    </div>
                  ) : (
                    <div key={x.key} style={{ fontSize: 12.5, padding: "6px 12px", borderRadius: 10, background: "var(--hub-bg-soft)" }}>
                      <b>{x.stage.toStage}{x.stage.toSubStatus && x.stage.toSubStatus !== x.stage.toStage ? ` · ${x.stage.toSubStatus}` : ""}</b>
                      <span style={{ color: "var(--hub-muted)" }}> · {x.stage.changedByName || "system"} · {fmt(x.stage.at)}</span>
                      {x.stage.remarks && <div>{x.stage.remarks}</div>}
                    </div>
                  )
                )}
                {!story.length && <div className="hub-empty">No calls yet.</div>}
              </div>
            </div>
          </div>

          <div style={{ flex: "1 1 280px", minWidth: 0, display: "grid", gap: 12 }}>
            <div>
              <Label>Send to</Label>
              <input className="hub-input" style={{ width: "100%", boxSizing: "border-box" }} aria-label="Search people" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[["", "All"], ...roles.map((x) => [x, x])].map(([k, label]) => (
                <button key={k || "all"} type="button" className={`hub-btn ${role === k ? "hub-btn-primary" : ""}`} style={{ padding: "4px 12px", borderRadius: 999, fontSize: 12.5 }} aria-pressed={role === k} onClick={() => setRole(k)}>{label}</button>
              ))}
            </div>
            <div style={{ display: "grid", gap: 4, maxHeight: 250, overflowY: "auto" }}>
              {!people && <div className="hub-empty">Loading…</div>}
              {people && !shown.length && <div className="hub-empty">Nobody found.</div>}
              {shown.map((p) => {
                const done = sentTo.get(String(p._id));
                return (
                  <label key={p._id} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, padding: "4px 10px", borderRadius: 10, border: "1px solid var(--hub-border)", cursor: done ? "default" : "pointer", opacity: done ? 0.65 : 1, background: picked.includes(p._id) ? "var(--hub-bg-soft)" : "transparent" }}>
                    <input type="checkbox" disabled={!!done} checked={!!done || picked.includes(p._id)} onChange={() => toggle(p._id)} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>{p.name}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--hub-muted)" }}>{done ? `Sent ${fmt(done.at)}` : p.role}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--hub-muted)", textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 700 }}>
              Your note (optional)
              <textarea className="hub-input" rows={3} style={{ width: "100%", boxSizing: "border-box", height: "auto", textTransform: "none", fontWeight: 500, letterSpacing: 0, fontSize: 13 }} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Why this lead is ready, best time to call…" />
            </label>
            <div style={{ fontSize: 12, color: "var(--hub-muted)" }}>They get a CRM notification and an email with all the calls and notes. Recordings open inside the CRM.</div>
          </div>
        </div>
      )}
    </HubModal>
  );
}
