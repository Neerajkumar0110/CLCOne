import React, { useEffect, useState } from "react";
import dayjs from "dayjs";
import { message } from "antd";
import { useSelector } from "react-redux";
import { request } from "@/request";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { FULL_ACCESS_ROLES } from "@/config/permissionModules";
import { useCallingMeta } from "@/pages/Calling/shared";
import { Head, Pager, Empty, Fail, nf, talk, fmtWhen } from "../ui";
import { LeadLnk, AgentLnk } from "../popups/Popups";
import { CallerDetail, SendProspect } from "../popups/CallPopups";
import { RecordingModal } from "./Recordings";
import { codeText } from "@/utils/callResponse";

// v3 design — S3CallHistory. Data: GET calling/history (q, campaign, agent, status,
// disposition, direction, from, to, page, items). Play = C7 Recording
// (calling/recordings/:id), Details = C2 (my-calls/:id/detail), Send for
// verification = C3 (my-calls/:id/send-prospect).
const RESULT = {
  connected: ["Connected", "b gr"],
  completed: ["Connected", "b gr"],
  "no-answer": ["Not answered", "b gy"],
  busy: ["Busy", "b or"],
  failed: ["Failed", "b rd"],
  voicemail: ["Voicemail", "b gy"],
  transferred: ["Transferred", "b bl"],
  ringing: ["Ringing", "b or"],
  dialing: ["Dialing", "b bl"],
  "not-placed": ["Not placed", "b rd"],
};
// The result a person should read, by the same rule as My Day / Auto Dialer (sales360 CONNECTED):
// "Connected" only when the customer answered, the user's own leg answered and there was talk time.
// A call the customer answered but no user ever picked up is "Not picked", not Connected, and busy /
// no-answer stored as "failed" + what the provider said read as Busy / Not answered.
function resultOf(r) {
  const said = String(r.providerRaw?.CallStatus || "").toLowerCase();
  if (["connected", "completed"].includes(r.status)) {
    if (r.missedByAgent || r.agentLegAnswered === false || !(r.duration > 0)) return ["Not picked", "b or", "The customer answered but no user picked the call up"];
    return RESULT.connected;
  }
  if (r.status === "failed" && RESULT[said]) return RESULT[said];
  return RESULT[r.status] || [r.status || "—", "b gy"];
}
const RANGES = [
  ["today", "Today", () => dayjs().startOf("day")],
  ["7d", "7 days", () => dayjs().subtract(6, "day").startOf("day")],
  ["30d", "30 days", () => dayjs().subtract(29, "day").startOf("day")],
  ["custom", "Custom", null],
];
const BLANK = { q: "", status: "", agent: "", direction: "", campaign: "", disposition: "", range: "7d", from: "", to: "" };
const typeOf = (r) => (r.instantLead ? "Facebook lead" : r.direction === "Inbound" ? "Inbound" : /pool/i.test(r.campaign?.name || "") ? "Lead pool" : "Dialer / callbacks");
const PlayIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>;

export default function CallHistory() {
  const me = useSelector(selectCurrentAdmin);
  const seesAll = FULL_ACCESS_ROLES.includes(me?.role);
  const meta = useCallingMeta();
  const [campaigns, setCampaigns] = useState([]);
  const [draft, setDraft] = useState(BLANK);
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(20);
  const [d, setD] = useState({ rows: [], count: 0, pages: 1, loading: true, error: false });
  const [tick, setTick] = useState(0);
  const [modal, setModal] = useState(null);

  useEffect(() => {
    request.get({ entity: "calling/campaigns?items=100" }).then((r) => r?.success && setCampaigns(r.result || []));
  }, []);
  useEffect(() => {
    let live = true;
    setD((x) => ({ ...x, loading: true, error: false }));
    const p = new URLSearchParams({ page: String(page), items: String(per) });
    ["q", "status", "agent", "campaign", "disposition", "direction"].forEach((k) => f[k] && p.set(k, f[k]));
    if (f.range === "custom") {
      if (f.from) p.set("from", dayjs(f.from).startOf("day").toISOString());
      if (f.to) p.set("to", dayjs(f.to).endOf("day").toISOString());
    } else p.set("from", (RANGES.find((r) => r[0] === f.range) || RANGES[1])[2]().toISOString());
    request.get({ entity: `calling/history?${p}` }).then((r) => {
      if (!live) return;
      if (r?.success) setD({ rows: r.result || [], count: r.pagination?.count || 0, pages: r.pagination?.pages || 1, loading: false, error: false });
      else setD({ rows: [], count: 0, pages: 1, loading: false, error: true });
    });
    return () => {
      live = false;
    };
  }, [f, page, per, tick]);

  const apply = (n) => {
    setF(n);
    setDraft(n);
    setPage(1);
  };
  const dispLabel = (code) => (meta.dispositions || []).find((x) => x.code === code)?.label || code || "";
  const pills = [
    f.q && ["q", `Search: ${f.q}`],
    f.status && ["status", `Result: ${RESULT[f.status]?.[0] || f.status}`],
    f.agent && ["agent", `Agent: ${(meta.agents || []).find((a) => a._id === f.agent)?.name || "Agent"}`],
    f.direction && ["direction", f.direction === "Inbound" ? "Inbound" : "Outgoing"],
    f.campaign && ["campaign", `Campaign: ${campaigns.find((c) => c._id === f.campaign)?.name || "Campaign"}`],
    f.disposition && ["disposition", `Disposition: ${dispLabel(f.disposition)}`],
  ].filter(Boolean);
  const mine = (r) => String(r.agent) === String(me?._id);
  const recRow = (r) => ({ _id: r._id, contactName: r.contactName, phone: r.phone, at: r.endedAt || r.created, agentName: r.agentName, direction: r.direction, durationSec: r.recording?.durationSec || r.duration, recordingStatus: r.recording?.status || "unavailable", campaign: r.campaign?.name, ownerOnly: r.ownerOnly });

  return (
    <>
      <Head crumb="Sales › Call History" title="Call History" lead="Every call, one row each. Play, read the response, send for verification."><span className="src">calling/history (+ lead-pool/used-leads filters)</span></Head>
      <section className="fp" aria-label="Filters">
        <div className="row">
          <label className="srch">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5B6B79" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
            <input type="search" placeholder="Search contact, number or agent…" aria-label="Search calls" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && apply({ ...draft, q: e.currentTarget.value })} />
          </label>
          <div className="seg" role="group" aria-label="Date">
            {RANGES.map(([k, l]) => <button key={k} type="button" className={draft.range === k ? "on" : ""} onClick={() => setDraft({ ...draft, range: k })}>{l}</button>)}
          </div>
        </div>
        <div className="fgrid">
          {draft.range === "custom" && (
            <>
              <label className="fld">From<input className="in" type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
              <label className="fld">To<input className="in" type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
            </>
          )}
          <label className="fld">Result
            <select className="sel" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">All results</option><option value="connected">Connected</option><option value="no-answer">Not answered</option><option value="busy">Busy</option><option value="failed">Failed</option>
            </select>
          </label>
          {(meta.agents || []).length > 0 && (
            <label className="fld">Agent
              <select className="sel" value={draft.agent} onChange={(e) => setDraft({ ...draft, agent: e.target.value })}><option value="">All agents</option>{meta.agents.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}</select>
            </label>
          )}
          <label className="fld">Call type
            <select className="sel" value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value })}><option value="">All call types</option><option value="Outbound">Outgoing</option><option value="Inbound">Inbound</option></select>
          </label>
          <label className="fld">Campaign
            <select className="sel" value={draft.campaign} onChange={(e) => setDraft({ ...draft, campaign: e.target.value })}><option value="">All campaigns</option>{campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</select>
          </label>
          <label className="fld">Disposition
            <select className="sel" value={draft.disposition} onChange={(e) => setDraft({ ...draft, disposition: e.target.value })}><option value="">All dispositions</option>{(meta.dispositions || []).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select>
          </label>
        </div>
        <div className="factions">
          <div className="applied">
            {pills.map(([k, l]) => <button key={k} type="button" className="pill" onClick={() => apply({ ...f, [k]: "" })}>{l} ✕</button>)}
            <span className="mut" style={{ fontSize: 12.5 }}>{d.loading ? "Loading…" : `${nf(d.count)} calls`}</span>
          </div>
          <div className="row">
            <button type="button" className="btn g" onClick={() => apply(BLANK)}>Reset</button>
            <button type="button" className="btn p" onClick={() => apply(draft)}>Apply</button>
          </div>
        </div>
      </section>

      <div className="tw">
        <table>
          <thead><tr><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Play</span></th><th scope="col" className="s">When ↓</th><th scope="col">Lead</th><th scope="col">Agent</th><th scope="col">Type</th><th scope="col">Result</th><th scope="col" className="num">Talk</th><th scope="col">Response</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th></tr></thead>
          <tbody>
            {d.loading && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={9}><div className="skel" style={{ height: 22 }} /></td></tr>)}
            {!d.loading && d.rows.map((r) => {
              const res = resultOf(r);
              const rec = r.recording?.status === "available";
              const resp = [dispLabel(r.disposition), codeText(r.notes)].filter(Boolean).join(" · ");
              return (
                <tr key={r._id}>
                  <td><button type="button" className="play" disabled={!rec} aria-label="Play recording" title={rec ? "Play recording" : r.recording?.status === "processing" ? "Recording processing" : "No recording"} onClick={() => setModal({ kind: "rec", row: recRow(r) })}><PlayIcon /></button></td>
                  <td>{fmtWhen(r.endedAt || r.created)}</td>
                  <td><LeadLnk phone={r.phone} ink>{r.contactName || "—"}</LeadLnk><div><LeadLnk phone={r.phone} /></div></td>
                  <td>{r.agentName ? <AgentLnk name={r.agentName} /> : "—"}{r.ownerOnly && <div className="mut" style={{ fontSize: 11.5 }}>not picked · their lead</div>}</td>
                  <td>{typeOf(r)}</td>
                  <td><span className={res[1]} title={res[2]}>{res[0]}</span></td>
                  <td className="num">{r.duration ? talk(r.duration) : "—"}</td>
                  <td style={{ whiteSpace: "normal", maxWidth: 240 }} title={resp}>{resp || "—"}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      {(seesAll || mine(r)) && <button type="button" className="btn sm" onClick={() => setModal({ kind: "detail", id: r._id, name: r.contactName || r.phone })}>Details</button>}
                      {mine(r) && ["connected", "completed"].includes(r.status) && <button type="button" className="btn sm" onClick={() => setModal({ kind: "send", call: { id: r._id, name: r.contactName || r.phone } })}>Send for verification</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!d.loading && d.error && <Fail onRetry={() => setTick((x) => x + 1)} text="Couldn’t load calls." />}
      {!d.loading && !d.error && d.rows.length === 0 && <Empty action={pills.length ? <button type="button" className="btn sm" onClick={() => apply(BLANK)}>Reset filters</button> : null} />}
      {d.count > 0 && <Pager page={page} pages={d.pages} count={d.count} per={per} pers={[10, 20, 50, 100]} onPer={(n) => { setPer(n); setPage(1); }} onPage={setPage} noun="calls" />}
      <div className="also"><b style={{ color: "#0F1E2B" }}>Totals &amp; charts for these calls:</b><a href="/sales-v3/reports">Call Reports →</a></div>

      {modal?.kind === "rec" && <RecordingModal row={modal.row} onClose={() => setModal(null)} />}
      {modal?.kind === "detail" && <CallerDetail callId={modal.id} title={modal.name} onClose={() => setModal(null)} />}
      {modal?.kind === "send" && <SendProspect call={modal.call} onClose={() => setModal(null)} onSent={() => { setModal(null); message.success("Sent for verification."); }} />}
    </>
  );
}
