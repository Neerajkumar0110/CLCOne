import React, { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { message } from "antd";
import { request } from "@/request";
import { useCallingMeta, usePoll, toDatetimeLocal, openTel } from "@/pages/Calling/shared";
import { Head, Modal, Skel, stageBadge } from "../ui";
import { LeadLnk } from "../popups/Popups";

// v3 design — S3DialerAgent › Agent Screen (+ C5 Transfer, C6 Schedule callback).
// Same API as before:
//   GET  calling/agent/active (every 2 s)            → { call, lead, crmLead }
//   POST calling/agent/call/:id/answer|mute|hold|transfer|callback|note|disposition|hangup
//   POST calling/manual/end/:id                       → device (manual) calls
const IP = {
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4l2.8.7a2 2 0 0 1 1.7 2z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  play: "M7 4l13 8-13 8z",
  mute: "M1 1l22 22M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.6M17 16.9A7 7 0 0 1 5 12v-2M19 10v2a7 7 0 0 1-.1 1.2M12 19v3",
  mic: "M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  swap: "M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16",
  cal: "M3 5h18v16H3zM16 3v4M8 3v4M3 10h18",
  end: "M10.7 13.3a16 16 0 0 0 3 2.3l1.3-1.3a2 2 0 0 1 2.1-.4l2.8.7a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.4 4.2 2 2 0 0 1 5.4 2h3a2 2 0 0 1 2 1.7M23 1L1 23",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  note: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8",
  check: "M20 6L9 17l-5-5",
  headset: "M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z",
};
const Ico = ({ n, s = 16 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><path d={IP[n]} /></svg>;
const H3 = ({ n, children }) => <h3 className="sv3-h3i"><span className="sv3-hi"><Ico n={n} s={15} /></span>{children}</h3>;
const STATUS = { connected: ["Connected", "#14532D", "#BBF7D0"], onhold: ["On hold", "#7C2D12", "#FED7AA"], ringing: ["Ringing", "#1E3A8A", "#BFDBFE"], dialing: ["Dialing", "#1E3A8A", "#BFDBFE"], queued: ["Queued", "#334155", "#E2E8F0"] };
const mmss = (s) => {
  const t = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(t / 3600);
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// C6 — Schedule callback
function ScheduleCallback({ meta, who, onClose, onSubmit }) {
  const [when, setWhen] = useState(toDatetimeLocal(new Date(Date.now() + 3600e3)));
  const [notes, setNotes] = useState("");
  const [agent, setAgent] = useState("");
  const [busy, setBusy] = useState(false);
  const quick = [
    ["In 1 hour", () => dayjs().add(1, "hour")],
    ["In 3 hours", () => dayjs().add(3, "hour")],
    ["Tomorrow 11:00 AM", () => dayjs().add(1, "day").hour(11).minute(0).second(0)],
    ["Tomorrow 5:00 PM", () => dayjs().add(1, "day").hour(17).minute(0).second(0)],
  ];
  const save = async () => {
    setBusy(true);
    await onSubmit({ scheduledAt: new Date(when).toISOString(), notes, assignedAgent: agent || undefined });
    setBusy(false);
  };
  return (
    <Modal title="Schedule callback" sub={who} onClose={onClose} width={520} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={!when || busy} onClick={save}>{busy ? "Scheduling…" : "Schedule"}</button></>}>
      <label className="fld">When <span className="req">*</span><input className="in" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
      <div className="sv3-qt">{quick.map(([l, fn]) => <button key={l} type="button" onClick={() => setWhen(toDatetimeLocal(fn().toDate()))}>{l}</button>)}</div>
      {(meta.agents || []).length > 0 && (
        <label className="fld" style={{ marginTop: 10 }}>Assigned to
          <select className="sel" value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">Me</option>{meta.agents.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}</select>
        </label>
      )}
      <label className="fld" style={{ marginTop: 10 }}>Note<input className="in" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    </Modal>
  );
}

export default function AgentScreen({ go }) {
  const meta = useCallingMeta();
  const [data, setData] = useState(undefined); // undefined = loading, null = idle
  const [now, setNow] = useState(Date.now());
  const [disp, setDisp] = useState("");
  const [note, setNote] = useState("");
  const [xMode, setXMode] = useState("agent");
  const [xAgent, setXAgent] = useState("");
  const [xTeam, setXTeam] = useState("");
  const [cbOpen, setCbOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const noteInit = useRef(false);

  const refresh = async () => {
    const r = await request.get({ entity: "calling/agent/active" });
    setData(r?.success ? r.result : null);
  };
  usePoll(refresh, 2000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const call = data?.call;
  const lead = data?.lead;
  const crm = data?.crmLead;
  const isManual = call?.provider === "manual";
  useEffect(() => {
    if (call && !noteInit.current) {
      setNote(call.notes || "");
      setDisp(call.disposition || "");
      noteInit.current = true;
    }
    if (!call) noteInit.current = false;
  }, [call]);

  const act = async (path, body, ok) => {
    if (!call) return;
    setBusy(path);
    const r = await request.post({ entity: `calling/agent/call/${call._id}/${path}`, jsonData: body || {} });
    setBusy("");
    if (r?.success) ok && message.success(ok);
    else message.error(r?.message || "Could not do that.");
    refresh();
  };
  const talkSec = call?.answeredAt ? (now - new Date(call.answeredAt).getTime()) / 1000 : 0;
  const endManual = async () => {
    setBusy("end");
    const r = await request.post({ entity: `calling/manual/end/${call._id}`, jsonData: { disposition: disp || undefined, notes: note, talkSeconds: Math.round(talkSec) } });
    setBusy("");
    if (!r?.success) message.error(r?.message || "Could not end the call.");
    refresh();
  };
  const end = () => (isManual ? endManual() : act("hangup", { disposition: disp || undefined, notes: note }));

  const head = <Head crumb="Sales › Agent Screen" title="Agent Screen" lead="The live call. Same controls: answer, hold, mute, transfer, schedule callback." />;
  if (data === undefined) return <>{head}<Skel h={260} /></>;
  if (!call) {
    return (
      <>
        {head}
        <div className="sv3-callbar" style={{ justifyContent: "flex-start" }}>
          <span className="sv3-hi" style={{ width: 44, height: 44, background: "#12303F", color: "#5EC4B6" }}><Ico n="headset" s={22} /></span>
          <div>
            <div className="t" style={{ fontSize: 22 }}>No active call</div>
            <div style={{ color: "#9FB3C3", fontSize: 13 }}>Once a call connects it shows here — answer, hold, mute, transfer, response and callback.</div>
          </div>
          <span className="sp" />
          <div className="ctl">
            {go && <button type="button" onClick={() => go("dialer")}><Ico n="phone" /> Open Dialer</button>}
            {go && <button type="button" onClick={() => go("auto")}><Ico n="play" /> Auto Dialer</button>}
          </div>
        </div>
      </>
    );
  }

  const connected = ["connected", "onhold"].includes(call.status);
  const st = STATUS[call.status] || [call.status, "#334155", "#E2E8F0"];
  const name = crm?.name || call.contactName || lead?.name || "Unknown";
  const from = call.campaignName || call.campaign?.name || (call.direction === "inbound" ? "Incoming call" : isManual ? "Device call" : "Dialer");
  const teams = meta.transferTargets || ["Sales", "Finance", "Support"];

  return (
    <>
      {head}
      <div className="sv3-callbar">
        <div>
          <span className="b" style={{ background: st[1], color: st[2] }}>{st[0]}</span>
          {isManual && <span className="b" style={{ background: "#3B0764", color: "#E9D5FF", marginLeft: 6 }}>device call</span>}
          {call.muted && <span className="b" style={{ background: "#7F1D1D", color: "#FECACA", marginLeft: 6 }}>muted</span>}
          <div className="t">{call.answeredAt ? mmss(talkSec) : "connecting…"}</div>
          <div style={{ color: "#9FB3C3", fontSize: 13 }}>{name} · {call.phone} · from {from}</div>
        </div>
        <div className="ctl">
          {!isManual && (call.status === "ringing" || call.status === "dialing") && <button type="button" className="ans" disabled={busy === "answer"} onClick={() => act("answer")}><Ico n="phone" /> Answer</button>}
          {!isManual && <button type="button" disabled={!connected || busy === "hold"} onClick={() => act("hold", { on: call.status !== "onhold" })}><Ico n={call.status === "onhold" ? "play" : "pause"} /> {call.status === "onhold" ? "Resume" : "Hold"}</button>}
          {!isManual && <button type="button" disabled={!connected || busy === "mute"} onClick={() => act("mute", { on: !call.muted })}><Ico n={call.muted ? "mic" : "mute"} /> {call.muted ? "Unmute" : "Mute"}</button>}
          {!isManual && <button type="button" disabled={!connected} onClick={() => document.getElementById("sv3-xfer")?.scrollIntoView({ behavior: "smooth", block: "center" })}><Ico n="swap" /> Transfer</button>}
          {isManual && <button type="button" onClick={() => openTel(`tel:${String(call.phone).replace(/[^\d+]/g, "")}`)}><Ico n="phone" /> Dial again</button>}
          <button type="button" onClick={() => setCbOpen(true)}><Ico n="cal" /> Schedule callback</button>
          <button type="button" className="end" disabled={busy === "hangup" || busy === "end"} onClick={end}><Ico n="end" /> {isManual ? "End & log call" : "End call"}</button>
        </div>
      </div>

      <div className="g2">
        <div className="card">
          <div className="ch"><H3 n="user">Caller</H3><span className="src">calling/agent/active</span></div>
          <div className="kv">
            <span>Name</span><span><LeadLnk phone={call.phone} ink>{name}</LeadLnk></span>
            <span>Phone number</span><span><LeadLnk phone={call.phone} /></span>
            <span>Email</span><span>{crm?.email || lead?.email || "—"}</span>
            <span>Company</span><span>{lead?.company || "—"}</span>
            <span>Source</span><span>{crm?.source || lead?.source || "—"}</span>
            {crm?.stage && <><span>Stage</span><span><span className={stageBadge(crm.stage)}>{crm.stage}</span>{crm.subStatus ? <span className="mut"> · {crm.subStatus}</span> : null}</span></>}
            <span>Attempts</span><span>{lead ? String(lead.attempts || 0) : "—"}</span>
            <span>Lead notes</span><span style={{ whiteSpace: "pre-wrap" }}>{lead?.notes || crm?.remarks || "—"}</span>
          </div>
        </div>
        {!isManual ? (
          <div className="card" id="sv3-xfer">
            <div className="ch"><H3 n="swap">Transfer call</H3><span className="mut" style={{ fontSize: 12 }}>Test mode — the transfer is simulated</span></div>
            <div className="seg" style={{ marginBottom: 12 }}>
              <button type="button" className={xMode === "agent" ? "on" : ""} onClick={() => setXMode("agent")}>To agent</button>
              <button type="button" className={xMode === "team" ? "on" : ""} onClick={() => setXMode("team")}>To team</button>
            </div>
            {xMode === "agent" ? (
              <label className="fld">Agent
                <select className="sel" value={xAgent} onChange={(e) => setXAgent(e.target.value)}><option value="">Select an agent</option>{(meta.agents || []).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}</select>
              </label>
            ) : (
              <label className="fld">Team / queue
                <select className="sel" value={xTeam || teams[0]} onChange={(e) => setXTeam(e.target.value)}>{teams.map((t) => <option key={t} value={t}>{t}</option>)}</select>
              </label>
            )}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => { setXAgent(""); setXTeam(""); }}>Cancel</button>
              <button type="button" className="btn p" disabled={!connected || busy === "transfer" || (xMode === "agent" && !xAgent)} onClick={() => act("transfer", xMode === "agent" ? { toAgent: xAgent } : { target: xTeam || teams[0] }, "Transferred.")}><Ico n="swap" s={14} /> Transfer</button>
            </div>
          </div>
        ) : <div />}
      </div>

      <div className="card">
        <div className="ch"><H3 n="note">Response &amp; note</H3><span className="src">…/note · …/disposition</span></div>
        <div className="fgrid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))" }}>
          <label className="fld">Call note<textarea className="in" rows={4} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => !isManual && act("note", { notes: note })} /></label>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="fld">Response (disposition)
              <select className="sel" value={disp} onChange={(e) => setDisp(e.target.value)}><option value="">Select</option>{(meta.dispositions || []).map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}</select>
            </label>
            <div className="row">
              <button type="button" className="btn p" disabled={!disp || busy === "disposition" || busy === "end"} onClick={() => (isManual ? endManual() : act("disposition", { disposition: disp, notes: note }, "Response saved."))}><Ico n="check" s={14} /> {isManual ? "Save & end" : "Save response"}</button>
              <button type="button" className="btn" onClick={() => setCbOpen(true)}><Ico n="cal" s={14} /> Schedule callback</button>
            </div>
          </div>
        </div>
      </div>

      {cbOpen && <ScheduleCallback meta={meta} who={`${name} · ${call.phone}`} onClose={() => setCbOpen(false)} onSubmit={async (body) => { await act("callback", body, "Callback scheduled."); setCbOpen(false); }} />}
    </>
  );
}
