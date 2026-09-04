import React, { useEffect, useRef, useState } from "react";
import { request } from "@/request";
import HubModal from "@/components/HubModal";
import {
  PhoneOutlined,
  PauseOutlined,
  AudioMutedOutlined,
  SwapOutlined,
  CloseCircleOutlined,
  MobileOutlined,
} from "@ant-design/icons";
import { CALL_STATUS_BADGE, fmtDuration, useCallingMeta, usePoll, toDatetimeLocal, openTel } from "./shared";

export default function AgentScreen() {
  const meta = useCallingMeta();
  const [data, setData] = useState(undefined); // undefined=loading, null=idle
  const [now, setNow] = useState(Date.now());
  const [xferOpen, setXferOpen] = useState(false);
  const [cbOpen, setCbOpen] = useState(false);
  const [disp, setDisp] = useState("");
  const [note, setNote] = useState("");
  const noteInit = useRef(false);

  // Quick-call form on the idle screen.
  const [qcPhone, setQcPhone] = useState("");
  const [qcName, setQcName] = useState("");
  const [qcErr, setQcErr] = useState("");
  const [qcMsg, setQcMsg] = useState("");
  // Agent's own number — needed when CALLING_PROVIDER=cloud (provider rings
  // this first). Remembered per-device.
  const [qcMy, setQcMy] = useState(() => {
    try { return localStorage.getItem("calling.agentPhone") || ""; } catch { return ""; }
  });
  const [prov, setProv] = useState(null);
  useEffect(() => {
    request.get({ entity: "calling/status" }).then((r) => r?.success && setProv(r.result));
  }, []);
  const isCloud = prov?.provider === "cloud";

  const refresh = async () => {
    const r = await request.get({ entity: "calling/agent/active" });
    setData(r?.success ? r.result : null);
  };
  usePoll(refresh, 2000);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const call = data && data.call;
  const lead = data && data.lead;
  const isManual = call && call.provider === "manual";

  useEffect(() => {
    if (call && !noteInit.current) {
      setNote(call.notes || "");
      setDisp(call.disposition || "");
      noteInit.current = true;
    }
    if (!call) noteInit.current = false;
  }, [call]);

  const act = async (path, body) => {
    if (!call) return;
    await request.post({ entity: `calling/agent/call/${call._id}/${path}`, jsonData: body || {} });
    refresh();
  };

  const talkSeconds = call && call.answeredAt ? (now - new Date(call.answeredAt).getTime()) / 1000 : 0;
  const timer = call
    ? call.answeredAt
      ? fmtDuration(talkSeconds)
      : "connecting…"
    : "";

  const endManual = async () => {
    if (!call) return;
    await request.post({
      entity: `calling/manual/end/${call._id}`,
      jsonData: { disposition: disp || undefined, notes: note, talkSeconds: Math.round(talkSeconds) },
    });
    refresh();
  };

  const startQuickCall = async () => {
    setQcErr("");
    setQcMsg("");
    if (qcPhone.replace(/\D/g, "").length < 8) return setQcErr("Enter a valid phone number.");
    if (isCloud && qcMy.replace(/\D/g, "").length < 8) return setQcErr("Enter your own number — the provider rings you first.");
    if (isCloud) {
      try { localStorage.setItem("calling.agentPhone", qcMy); } catch { /* ignore */ }
    }
    const r = await request.post({
      entity: "calling/manual/dial",
      jsonData: {
        phone: qcPhone,
        contactName: qcName || undefined,
        agentPhone: isCloud ? qcMy : undefined,
      },
    });
    if (r?.success) {
      if (r.result?.bridged) {
        setQcMsg(r.message || "Calling your phone now — pick up to connect.");
      } else if (r.result?.tel) {
        openTel(r.result.tel);
      }
      setQcPhone("");
      setQcName("");
      refresh();
    } else {
      setQcErr(r?.message || "Could not start the call.");
    }
  };

  if (data === undefined) return <div className="hub-card"><div className="hub-empty">Loading…</div></div>;

  // ── idle ──────────────────────────────────────────────────────────────
  if (!call) {
    return (
      <div className="hub-stack">
        <div className="hub-card">
          <div className="hub-card-header"><h3><PhoneOutlined /> Agent Calling Screen</h3></div>
          <div className="hub-empty">
            No active call. Use <strong>Dial Next</strong> on the Auto Dialer for a simulated call, or make a real
            call from your phone below.
          </div>
        </div>

        <div className="hub-card">
          <div className="hub-card-header">
            <h3><MobileOutlined /> Quick Call {isCloud ? "" : "(from your phone)"}</h3>
            {prov && <span className={`hub-badge ${isCloud ? "hub-badge-green" : "hub-badge-gray"}`}>{prov.label}</span>}
          </div>
          <div style={{ fontSize: 12.5, color: "#8c8c8c", marginBottom: 12 }}>
            {isCloud
              ? "The provider rings your number first — pick up, then it connects you to the customer. The call is recorded and logged."
              : "Opens your device dialer / softphone. The voice call runs on your phone; the CRM logs the contact, timing, disposition and notes."}
          </div>
          <div className="hub-grid-2">
            {isCloud && (
              <div className="hub-form-row">
                <label>Your Number (rings first)</label>
                <input className="hub-input" value={qcMy} onChange={(e) => setQcMy(e.target.value)} placeholder="+91 90000 00000" />
              </div>
            )}
            <div className="hub-form-row">
              <label>Customer Phone Number</label>
              <input className="hub-input" value={qcPhone} onChange={(e) => setQcPhone(e.target.value)} placeholder="+91 98765 43210" />
            </div>
            <div className="hub-form-row">
              <label>Contact Name (optional)</label>
              <input className="hub-input" value={qcName} onChange={(e) => setQcName(e.target.value)} />
            </div>
          </div>
          <div className="hub-row" style={{ gap: 8, alignItems: "center" }}>
            <button type="button" className="hub-btn hub-btn-primary" onClick={startQuickCall}>
              <PhoneOutlined /> Call
            </button>
            {qcErr && <span className="hub-badge hub-badge-red">{qcErr}</span>}
            {qcMsg && <span className="hub-badge hub-badge-green">{qcMsg}</span>}
          </div>
        </div>
      </div>
    );
  }

  const connected = ["connected", "onhold"].includes(call.status);

  return (
    <div className="hub-stack">
      <div className="hub-card">
        <div className="hub-card-header">
          <h3>
            {call.contactName || "Unknown"}{" "}
            <span className={`hub-badge ${CALL_STATUS_BADGE[call.status]}`}>{call.status}</span>
            {isManual && <span className="hub-badge hub-badge-purple" style={{ marginLeft: 6 }}>device call</span>}
          </h3>
          <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 800, color: connected ? "#16a34a" : "#64748b" }}>
            {timer}
          </div>
        </div>

        <div className="hub-grid-2" style={{ gap: 16 }}>
          <div>
            <Field
              label="Phone Number"
              value={
                <>
                  {call.phone}{" "}
                  {isManual && (
                    <button
                      type="button"
                      className="hub-btn"
                      style={{ padding: "2px 10px", marginLeft: 6 }}
                      onClick={() => openTel(`tel:${String(call.phone).replace(/[^\d+]/g, "")}`)}
                    >
                      <PhoneOutlined /> Dial again
                    </button>
                  )}
                </>
              }
            />
            <Field label="Company" value={lead?.company} />
            <Field label="Email" value={lead?.email} />
            <Field label="Source" value={lead?.source} />
            <Field label="Attempts" value={lead ? String(lead.attempts || 0) : "—"} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#8c8c8c", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Lead Notes</div>
            <div style={{ fontSize: 13, background: "#f8fafc", border: "1px solid #eef0f4", borderRadius: 8, padding: "8px 10px", minHeight: 60 }}>
              {lead?.notes || "—"}
            </div>
          </div>
        </div>

        {/* controls */}
        <div className="hub-row" style={{ gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          {!isManual && (call.status === "ringing" || call.status === "dialing") && (
            <button type="button" className="hub-btn hub-btn-primary" onClick={() => act("answer")}>
              <PhoneOutlined /> Answer
            </button>
          )}
          {!isManual && (
            <>
              <button type="button" className="hub-btn" disabled={!connected} onClick={() => act("mute", { on: !call.muted })}>
                <AudioMutedOutlined /> {call.muted ? "Unmute" : "Mute"}
              </button>
              <button type="button" className="hub-btn" disabled={!connected} onClick={() => act("hold", { on: call.status !== "onhold" })}>
                <PauseOutlined /> {call.status === "onhold" ? "Resume" : "Hold"}
              </button>
              <button type="button" className="hub-btn" disabled={!connected} onClick={() => setXferOpen(true)}>
                <SwapOutlined /> Transfer
              </button>
            </>
          )}
          <button
            type="button"
            className="hub-btn"
            style={{ color: "#dc2626", borderColor: "#f3c9c9" }}
            onClick={() => (isManual ? endManual() : act("hangup", { disposition: disp || undefined, notes: note }))}
          >
            <CloseCircleOutlined /> {isManual ? "End & Log Call" : "End Call"}
          </button>
        </div>

        {/* note + disposition */}
        <div className="hub-grid-2" style={{ gap: 14, marginTop: 16 }}>
          <div className="hub-form-row">
            <label>Call Note</label>
            <textarea
              className="hub-input"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => !isManual && act("note", { notes: note })}
            />
          </div>
          <div>
            <div className="hub-form-row">
              <label>Disposition</label>
              <select className="hub-select" value={disp} onChange={(e) => setDisp(e.target.value)}>
                <option value="">— select —</option>
                {(meta.dispositions || []).map((d) => (
                  <option key={d.code} value={d.code}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="hub-row" style={{ gap: 8 }}>
              <button
                type="button"
                className="hub-btn"
                disabled={!disp}
                onClick={() => (isManual ? endManual() : act("disposition", { disposition: disp, notes: note }))}
              >
                {isManual ? "Save & End" : "Save Disposition"}
              </button>
              <button type="button" className="hub-btn" onClick={() => setCbOpen(true)}>Schedule Callback</button>
            </div>
          </div>
        </div>
      </div>

      {xferOpen && (
        <TransferModal
          meta={meta}
          onClose={() => setXferOpen(false)}
          onSubmit={async (body) => {
            await act("transfer", body);
            setXferOpen(false);
          }}
        />
      )}
      {cbOpen && (
        <CallbackModal
          meta={meta}
          onClose={() => setCbOpen(false)}
          onSubmit={async (body) => {
            await act("callback", body);
            setCbOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#8c8c8c", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 14, color: "#101828" }}>{value || "—"}</div>
    </div>
  );
}

function TransferModal({ meta, onClose, onSubmit }) {
  const [mode, setMode] = useState("team");
  const [target, setTarget] = useState((meta.transferTargets || [])[0] || "Sales");
  const [agent, setAgent] = useState("");
  return (
    <HubModal
      open
      onClose={onClose}
      title="Transfer Call"
      subtitle="Test mode — the transfer is simulated"
      width={420}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="hub-btn hub-btn-primary"
            onClick={() => onSubmit(mode === "team" ? { target } : { toAgent: agent })}
          >
            Transfer
          </button>
        </>
      }
    >
      <div className="hub-row" style={{ gap: 8, marginBottom: 12 }}>
        <button type="button" className={`hub-btn ${mode === "team" ? "hub-btn-primary" : ""}`} onClick={() => setMode("team")}>To Team</button>
        <button type="button" className={`hub-btn ${mode === "agent" ? "hub-btn-primary" : ""}`} onClick={() => setMode("agent")}>To Agent</button>
      </div>
      {mode === "team" ? (
        <div className="hub-form-row">
          <label>Team / Queue</label>
          <select className="hub-select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {(meta.transferTargets || ["Sales", "Finance", "Support"]).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="hub-form-row">
          <label>Agent</label>
          <select className="hub-select" value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">— select —</option>
            {(meta.agents || []).map((a) => (
              <option key={a._id} value={a._id}>{a.name}</option>
            ))}
          </select>
        </div>
      )}
    </HubModal>
  );
}

function CallbackModal({ meta, onClose, onSubmit }) {
  const [when, setWhen] = useState(toDatetimeLocal(new Date(Date.now() + 3600000)));
  const [notes, setNotes] = useState("");
  const [assignedAgent, setAssignedAgent] = useState("");
  return (
    <HubModal
      open
      onClose={onClose}
      title="Schedule Callback"
      width={420}
      footer={
        <>
          <button type="button" className="hub-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="hub-btn hub-btn-primary"
            disabled={!when}
            onClick={() => onSubmit({ scheduledAt: new Date(when).toISOString(), notes, assignedAgent: assignedAgent || undefined })}
          >
            Schedule
          </button>
        </>
      }
    >
      <div className="hub-form-row">
        <label>Callback Date &amp; Time <span style={{ color: "#ef4444" }}>*</span></label>
        <input type="datetime-local" className="hub-input" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <div className="hub-form-row">
        <label>Assigned Agent</label>
        <select className="hub-select" value={assignedAgent} onChange={(e) => setAssignedAgent(e.target.value)}>
          <option value="">Me</option>
          {(meta.agents || []).map((a) => (
            <option key={a._id} value={a._id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div className="hub-form-row">
        <label>Notes</label>
        <textarea className="hub-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </HubModal>
  );
}
