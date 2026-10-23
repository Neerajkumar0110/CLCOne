import React, { useEffect, useState } from "react";
import { request } from "@/request";
import { getSocket } from "@/socket";
import { PhoneOutlined, SwapOutlined, ReloadOutlined } from "@ant-design/icons";
import { fmtDuration, usePoll } from "./shared";
import "./IncomingCalls.css";

// Calls page → Incoming calls (backend callingController/inbound.js).
// A customer calling our number rings the user they last spoke to, else a
// free pool user, else a Team Leader — one phone at a time — and whoever
// takes it can forward it. Management sees every call; everyone else only
// the calls that rang them / were theirs.

const KIND_LABEL = { previous: "spoke before", owner: "lead owner", free: "free user", leader: "team leader", forward: "forwarded" };
const RESULT_CLASS = { answered: "is-green", missed: "is-red", cancelled: "is-gray", busy: "is-gray", failed: "is-gray", ringing: "is-amber" };
const RANGES = [
  [1, "Today"],
  [7, "7 days"],
  [30, "30 days"],
];
const STATES = [
  ["", "All"],
  ["missed", "Missed"],
  ["answered", "Answered"],
];

const fmtTime = (v, withDay) =>
  v
    ? new Date(v).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        ...(withDay ? { day: "2-digit", month: "short" } : {}),
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const prettyNumber = (n) => {
  const d = String(n || "").replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : n;
};

function Attempts({ list }) {
  if (!list?.length) return <span className="ic-muted">Nobody was free</span>;
  return (
    <div className="ic-attempts">
      {list.map((a, i) => (
        <span key={i} className={`ic-chip ${RESULT_CLASS[a.result] || ""}`} title={`${KIND_LABEL[a.kind] || a.kind} · ${a.device || ""} · ${fmtTime(a.at)}`}>
          {a.agentName || "—"} <small>· {a.result}</small>
        </span>
      ))}
    </div>
  );
}

function ForwardBox({ call, onDone }) {
  const [targets, setTargets] = useState(null);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request.get({ entity: "calling/inbound/forward-targets" }).then((r) => setTargets(r?.success ? r.result : []));
  }, []);
  const go = async () => {
    if (!to || busy) return;
    setBusy(true);
    const r = await request.post({ entity: `calling/inbound/${call._id}/forward`, jsonData: { toAgent: to } });
    setBusy(false);
    if (!r?.success) window.alert(r?.message || "Could not forward.");
    else onDone();
  };
  return (
    <div className="ic-forward">
      <select className="hub-select" value={to} onChange={(e) => setTo(e.target.value)} disabled={!targets}>
        <option value="">{targets ? "Forward to…" : "Loading…"}</option>
        {(targets || []).map((t) => (
          <option key={t.id} value={t.id} disabled={t.state === "busy" || t.state === "break"}>
            {t.name} — {t.role} · {t.state === "free" ? "free" : t.state}
          </option>
        ))}
      </select>
      <button type="button" className="hub-btn hub-btn-primary" disabled={!to || busy} onClick={go}>
        {busy ? "Ringing…" : "Forward"}
      </button>
    </div>
  );
}

function LiveCall({ c, now, canForward, onChanged }) {
  const [fwd, setFwd] = useState(false);
  const waited = Math.max(0, Math.round((now - new Date(c.at).getTime()) / 1000));
  return (
    <div className={`ic-live ${c.state === "talking" ? "is-talking" : "is-ringing"}`}>
      <span className="ic-live-dot" />
      <div className="ic-live-main">
        <div className="ic-live-title">
          <b>{c.name || "Unknown caller"}</b> <span className="ic-muted">{c.phone}</span>
          {c.lead?.stage && <span className="ic-chip">{c.lead.stage}</span>}
        </div>
        <div className="ic-live-sub">
          {c.state === "talking" ? (
            <>
              Talking with <b>{c.answeredBy || c.agentName}</b>
              {c.ringing?.kind === "forward" && <> · forwarding to <b>{c.ringing.agentName}</b>…</>}
            </>
          ) : c.ringing ? (
            <>
              Ringing <b>{c.ringing.agentName}</b> ({KIND_LABEL[c.ringing.kind] || c.ringing.kind}) · caller waiting {fmtDuration(waited)}
            </>
          ) : (
            <>Finding someone free · caller waiting {fmtDuration(waited)}</>
          )}
        </div>
        {c.attempts?.length > 0 && <Attempts list={c.attempts} />}
      </div>
      {canForward && c.state === "talking" && !c.ringing && (
        <button type="button" className="hub-btn" onClick={() => setFwd((v) => !v)}>
          <SwapOutlined /> Forward
        </button>
      )}
      {fwd && (
        <ForwardBox
          call={c}
          onDone={() => {
            setFwd(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

export default function IncomingCalls({ currentAdminId }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(1);
  const [state, setState] = useState("");
  const [now, setNow] = useState(Date.now());
  const [dialing, setDialing] = useState(null);
  const [playing, setPlaying] = useState(null);

  const load = async () => {
    const qs = new URLSearchParams({ days: String(days), ...(state ? { state } : {}) });
    const r = await request.get({ entity: `calling/inbound?${qs}` });
    if (r?.success) setData(r.result);
  };
  usePoll(load, 5000, [days, state]);

  // a call came in / changed → refresh right away
  useEffect(() => {
    const s = getSocket();
    if (!s) return undefined;
    const h = () => load();
    s.on("inbound:update", h);
    return () => s.off("inbound:update", h);
  }, [days, state]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = data?.live || [];
  useEffect(() => {
    if (!live.length) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live.length]);

  const callBack = async (c) => {
    if (dialing) return;
    setDialing(c._id);
    const r = await request.post({ entity: "calling/manual/dial", jsonData: { phone: c.phone, contactName: c.name || undefined } });
    setDialing(null);
    if (!r?.success) window.alert(r?.message || "Could not place the call.");
  };

  const s = data?.summary;
  const recent = data?.recent || [];

  return (
    <div className="hub-card ic-card">
      <div className="hub-card-header">
        <h3>
          <PhoneOutlined rotate={-135} /> Incoming calls
          {live.length > 0 && <span className="ic-live-count">{live.length} live</span>}
        </h3>
        <div className="hub-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <div className="hub-pill-filter">
            {RANGES.map(([k, l]) => (
              <button key={k} type="button" className={`hub-btn ${days === k ? "hub-btn-primary" : ""}`} onClick={() => setDays(k)}>
                {l}
              </button>
            ))}
          </div>
          <button type="button" className="hub-btn" onClick={load} title="Refresh">
            <ReloadOutlined />
          </button>
        </div>
      </div>

      <div className="ic-howto">
        Customers who call {data?.number ? <b>{prettyNumber(data.number)}</b> : "our number"} ring the user they last spoke to → else a free pool user →
        else a Team Leader, one phone at a time. Missed calls become a callback automatically.
        {data && !data.isAdmin && " You see the calls that rang you or were yours."}
      </div>

      {live.length > 0 && (
        <div className="ic-live-list">
          {live.map((c) => (
            <LiveCall key={c._id} c={c} now={now} canForward={data?.isAdmin || String(c.agent) === String(currentAdminId)} onChanged={load} />
          ))}
        </div>
      )}

      {s && (
        <div className="ic-stats">
          {[
            ["Calls", s.total, "#2563eb", ""],
            ["Answered", s.answered, "#16a34a", "answered"],
            ["Missed", s.missed, "#dc2626", "missed"],
            ["Callbacks pending", s.pendingCallbacks, "#d97706", null],
          ].map(([l, v, c, k]) => (
            <button
              key={l}
              type="button"
              className={`ic-stat ${k !== null && state === k ? "is-on" : ""}`}
              style={{ "--c": c, cursor: k === null ? "default" : "pointer" }}
              onClick={() => k !== null && setState(state === k && k ? "" : k)}
            >
              <span>{l}</span>
              <b>{v}</b>
            </button>
          ))}
        </div>
      )}

      <div className="hub-table-wrapper">
        <table className="hub-table ic-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Caller</th>
              <th>Result</th>
              <th>Rang</th>
              <th>Wait / Talk</th>
              <th>Follow-up</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!data && (
              <tr>
                <td colSpan={7}>
                  <div className="hub-empty">Loading…</div>
                </td>
              </tr>
            )}
            {data && recent.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="hub-empty">No incoming calls {days === 1 ? "today" : `in the last ${days} days`}{state ? ` (${state})` : ""}.</div>
                </td>
              </tr>
            )}
            {recent.map((c) => (
              <tr key={c._id}>
                <td style={{ whiteSpace: "nowrap" }}>{fmtTime(c.at, days > 1)}</td>
                <td>
                  <b>{c.name || "Unknown caller"}</b>
                  <div className="ic-muted">{c.phone}</div>
                  {c.lead && (
                    <div className="ic-muted">
                      {c.lead.stage}
                      {c.lead.owner ? ` · ${c.lead.owner}` : ""}
                    </div>
                  )}
                </td>
                <td>
                  {c.state === "answered" ? (
                    <span className="ic-chip is-green">Answered · {c.answeredBy}</span>
                  ) : (
                    <span className="ic-chip is-red">Missed</span>
                  )}
                  {c.forwardedBy && <div className="ic-muted">forwarded by {c.forwardedBy}</div>}
                  {c.disposition && <div className="ic-muted">{c.disposition}</div>}
                </td>
                <td>
                  <Attempts list={c.attempts} />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {fmtDuration(c.waitSec)} wait
                  {c.talkSec > 0 && <div className="ic-muted">{fmtDuration(c.talkSec)} talk</div>}
                </td>
                <td>
                  {c.callback ? (
                    <span className={`ic-chip ${c.callback.status === "Done" ? "is-green" : "is-amber"}`}>
                      Callback {c.callback.status === "Pending" ? "pending" : c.callback.status.toLowerCase()}
                      {c.callback.agentName ? ` · ${c.callback.agentName}` : ""}
                    </span>
                  ) : (
                    <span className="ic-muted">—</span>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <div className="hub-row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    {c.recordingUrl && (
                      <button type="button" className="hub-btn" onClick={() => setPlaying(playing === c._id ? null : c._id)}>
                        {playing === c._id ? "Hide" : "▶ Play"}
                      </button>
                    )}
                    <button type="button" className="hub-btn hub-btn-primary" disabled={!!dialing} onClick={() => callBack(c)}>
                      <PhoneOutlined /> {dialing === c._id ? "Calling…" : "Call back"}
                    </button>
                  </div>
                  {playing === c._id && <audio src={c.recordingUrl} controls autoPlay style={{ width: 240, marginTop: 6 }} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
