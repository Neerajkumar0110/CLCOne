import React, { useEffect, useRef, useState } from "react";
import { request } from "@/request";
import { Head, Modal, Pager, Skel, Empty, Fail, nf, initials, talk, fmtWhen } from "../ui";
import { LeadLnk, AgentLnk } from "../popups/Popups";

// v3 design — S3Recordings (+ C7 Recording popup). Data, same as before:
//   GET calling/recordings?q&agent&direction&status&campaign&from&to&page&items
//       → rows, summary { calls, available, processing, unavailable, coverage, byUser[] }, seesAll
//   GET calling/recordings/:id → { url, durationSec, status } for the player
const RANGES = [
  ["today", "Today"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["all", "All time"],
  ["custom", "Custom"],
];
const BLANK = { q: "", agent: "", direction: "", status: "", campaign: "", range: "30d", from: "", to: "" };
const STATUS = { available: ["Recorded", "b gr"], processing: ["Processing", "b gy"], unavailable: ["Not recorded", "b rd"] };
const istDayStart = (days) => {
  const now = new Date(Date.now() + 5.5 * 3600e3);
  now.setUTCHours(0, 0, 0, 0);
  return new Date(now.getTime() - 5.5 * 3600e3 - days * 864e5);
};
const rangeParams = (f) => {
  if (f.range === "today") return { from: istDayStart(0).toISOString() };
  if (f.range === "7d") return { from: istDayStart(6).toISOString() };
  if (f.range === "30d") return { from: istDayStart(29).toISOString() };
  if (f.range === "custom") {
    const out = {};
    if (f.from) out.from = new Date(`${f.from}T00:00:00+05:30`).toISOString();
    if (f.to) out.to = new Date(`${f.to}T23:59:59+05:30`).toISOString();
    return out;
  }
  return {};
};
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;
const PlayIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>;
const PauseIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>;

// C7 — Recording
export function RecordingModal({ row, onClose }) {
  const [info, setInfo] = useState({ loading: true });
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(row.durationSec || 0);
  const [rate, setRate] = useState(1);
  useEffect(() => {
    let live = true;
    request.get({ entity: `calling/recordings/${row._id}` }).then((r) => live && setInfo(r?.success ? { loading: false, ...r.result } : { loading: false, error: true }));
    return () => {
      live = false;
    };
  }, [row._id]);
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };
  const seek = (e) => {
    const a = audio.current;
    if (!a || !dur) return;
    const box = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(dur, ((e.clientX - box.left) / box.width) * dur));
  };
  const nextRate = () => {
    const r = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(r);
    if (audio.current) audio.current.playbackRate = r;
  };
  const st = STATUS[info.status || row.recordingStatus] || [info.status || row.recordingStatus || "—", "b gy"];
  return (
    <Modal title="Recording" sub={[row.contactName || "Unknown", fmtWhen(row.at), row.agentName, row.direction].filter(Boolean).join(" · ")} onClose={onClose} width={640} footer={<button type="button" className="btn p" onClick={onClose}>Close</button>}>
      {info.loading ? <Skel h={60} /> : info.url ? (
        <div className="sv3-player">
          <audio ref={audio} src={info.url} autoPlay preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)} />
          <button type="button" className="play" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
          <span className="bar" role="slider" tabIndex={0} aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)} onClick={seek} onKeyDown={(e) => { if (!audio.current) return; if (e.key === "ArrowRight") audio.current.currentTime += 5; if (e.key === "ArrowLeft") audio.current.currentTime -= 5; }}>
            <span style={{ width: `${dur ? (t / dur) * 100 : 0}%` }} />
          </span>
          <span className="num" style={{ fontSize: 13 }}>{mmss(t)} / {mmss(dur)}</span>
          <button type="button" className="btn sm" onClick={nextRate} aria-label="Playback speed">{rate}×</button>
          <a className="btn sm" href={info.url} target="_blank" rel="noreferrer" download style={{ textDecoration: "none" }}>Download</a>
        </div>
      ) : (
        <div className="warn">{info.error ? "Couldn’t load the recording." : "No recording for this call."}</div>
      )}
      <div className="kv" style={{ marginTop: 14 }}>
        <span>Status</span><span><span className={st[1]}>{st[0]}</span></span>
        <span>Duration</span><span>{info.durationSec || row.durationSec ? talk(info.durationSec || row.durationSec) : "—"}</span>
        <span>Campaign</span><span>{row.campaign || "—"}</span>
        <span>Number</span><span><LeadLnk phone={row.phone} /></span>
        <span>User</span><span>{row.agentName ? `${row.agentName}${row.ownerOnly ? " (not picked · their lead)" : ""}` : "—"}</span>
      </div>
    </Modal>
  );
}

export default function Recordings() {
  const [campaigns, setCampaigns] = useState([]);
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState(BLANK);
  const [f, setF] = useState(BLANK);
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(25);
  const [d, setD] = useState({ rows: [], summary: null, seesAll: false, count: 0, pages: 1, loading: true, error: false });
  const [tick, setTick] = useState(0);
  const [play, setPlay] = useState(null);

  useEffect(() => {
    request.get({ entity: "calling/campaigns?items=100" }).then((r) => r?.success && setCampaigns(r.result || []));
  }, []);
  useEffect(() => {
    let live = true;
    setD((x) => ({ ...x, loading: true, error: false }));
    const p = new URLSearchParams({ page: String(page), items: String(per) });
    ["q", "agent", "direction", "campaign", "status"].forEach((k) => f[k] && p.set(k, f[k]));
    Object.entries(rangeParams(f)).forEach(([k, v]) => p.set(k, v));
    request.get({ entity: `calling/recordings?${p}` }).then((r) => {
      if (!live) return;
      if (!r?.success) return setD((x) => ({ ...x, rows: [], loading: false, error: true }));
      setD({ rows: r.result || [], summary: r.summary || null, seesAll: !!r.seesAll, count: r.pagination?.count || 0, pages: r.pagination?.pages || 1, loading: false, error: false });
      if (r.summary?.byUser?.length) {
        setUsers((prev) => {
          const m = new Map(prev.map((u) => [String(u.id), u]));
          for (const u of r.summary.byUser) if (u.userId) m.set(String(u.userId), { id: u.userId, name: u.name });
          return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
        });
      }
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
  const s = d.summary || {};
  const talked = (s.available || 0) + (s.unavailable || 0) + (s.processing || 0);
  const pills = [
    f.q && ["q", `Search: ${f.q}`],
    f.agent && ["agent", `User: ${users.find((u) => String(u.id) === String(f.agent))?.name || "User"}`],
    f.direction && ["direction", f.direction === "Inbound" ? "Inbound" : "Outgoing"],
    f.status && ["status", `Status: ${STATUS[f.status]?.[0] || f.status}`],
    f.campaign && ["campaign", `Campaign: ${campaigns.find((c) => c._id === f.campaign)?.name || "Campaign"}`],
  ].filter(Boolean);
  const tile = (icon, label, value, sub, cls, key, iconStyle) => (
    <button type="button" className={`kpi${f.status === key ? " on" : ""}`} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }} aria-pressed={f.status === key} onClick={() => apply({ ...f, status: f.status === key ? "" : key })}>
      <div className="l"><i style={iconStyle}>{icon}</i>{label}</div>
      <div className="v">{d.loading && !d.summary ? <span className="skel" style={{ display: "block", height: 26, width: "60%" }} /> : value}</div>
      <div className={`d ${cls}`}>{sub}</div>
    </button>
  );

  return (
    <>
      <Head crumb="Sales › Recordings" title="Recordings" lead="Listen to calls and check every talked call was recorded."><span className="src">calling/recordings</span></Head>
      <div className="kpis">
        {tile("✓", "Recorded", nf(s.available), `${s.coverage ?? (talked ? Math.round(((s.available || 0) / talked) * 100) : 0)}% of talked calls`, "up", "available")}
        {tile("⟳", "Processing", nf(s.processing), "ready in minutes", "mut", "processing")}
        {tile("!", "Not recorded", nf(s.unavailable), "needs a look", "dn", "unavailable", { background: "#FDECEA", color: "#B42318" })}
      </div>

      <section className="fp" aria-label="Filters">
        <div className="row">
          <label className="srch">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5B6B79" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
            <input type="search" placeholder="Search name or number, press Enter" aria-label="Search recordings" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && apply({ ...draft, q: e.currentTarget.value.trim() })} />
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
          {(d.seesAll || users.length > 1) && (
            <label className="fld">User
              <select className="sel" value={draft.agent} onChange={(e) => setDraft({ ...draft, agent: e.target.value })}>
                <option value="">All users</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
          <label className="fld">Direction
            <select className="sel" value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value })}>
              <option value="">All</option><option value="Outbound">Outgoing</option><option value="Inbound">Inbound</option>
            </select>
          </label>
          <label className="fld">Status
            <select className="sel" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">All</option><option value="available">Recorded</option><option value="processing">Processing</option><option value="unavailable">Not recorded</option>
            </select>
          </label>
          <label className="fld">Campaign
            <select className="sel" value={draft.campaign} onChange={(e) => setDraft({ ...draft, campaign: e.target.value })}>
              <option value="">All campaigns</option>
              {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
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

      <div className="g2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))" }}>
        <div style={{ gridColumn: d.seesAll ? "span 2" : "1 / -1", minWidth: 0 }} className="tw sv3-rec">
          <table>
            <thead><tr><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Play</span></th><th scope="col">Date / time</th><th scope="col">User</th><th scope="col">Lead</th><th scope="col">Type</th><th scope="col" className="num">Duration</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {d.loading && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={7}><div className="skel" style={{ height: 22 }} /></td></tr>)}
              {!d.loading && d.rows.map((r) => {
                const st = STATUS[r.recordingStatus] || [r.recordingStatus, "b gy"];
                return (
                  <tr key={r._id}>
                    <td>{r.recordingStatus === "available" && <button type="button" className="play" aria-label={`Play the call with ${r.contactName || r.phone}`} onClick={() => setPlay(r)}><PlayIcon /></button>}</td>
                    <td>{fmtWhen(r.at)}</td>
                    <td>{r.agentName ? <AgentLnk name={r.agentName} /> : "—"}{r.ownerOnly && <div className="mut" style={{ fontSize: 11.5 }}>not picked · their lead</div>}</td>
                    <td><LeadLnk phone={r.phone} ink>{r.contactName || r.phone || "Unknown"}</LeadLnk>{r.campaign && <div className="mut" style={{ fontSize: 12 }}>{r.campaign}</div>}</td>
                    <td>{r.direction === "Inbound" ? "Inbound" : "Outgoing"}</td>
                    <td className="num">{r.durationSec ? mmss(r.durationSec) : "—"}</td>
                    <td>{r.recordingStatus === "available" ? <button type="button" className={st[1]} style={{ border: 0, cursor: "pointer" }} onClick={() => setPlay(r)}>{st[0]}</button> : <span className={st[1]}>{st[0]}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!d.loading && d.error && <Fail onRetry={() => setTick((x) => x + 1)} text="Couldn’t load the recordings." />}
          {!d.loading && !d.error && d.rows.length === 0 && <Empty action={pills.length ? <button type="button" className="btn sm" onClick={() => apply(BLANK)}>Reset filters</button> : null} />}
          {d.count > 0 && <div style={{ padding: 12 }}><Pager page={page} pages={d.pages} count={d.count} per={per} pers={[25, 50, 100]} onPer={(n) => { setPer(n); setPage(1); }} onPage={setPage} noun="calls" /></div>}
        </div>
        {d.seesAll && (
          <div className="card">
            <div className="ch"><div><h3>By user</h3><p>Recording on / off per user · click to filter</p></div></div>
            {!d.summary ? <Skel h={200} /> : !(s.byUser || []).length ? <Empty /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13.5 }}>
                {s.byUser.map((u) => {
                  const on = u.userId && String(u.userId) === String(f.agent);
                  return (
                    <div key={u.userId || "none"} className="row" style={{ justifyContent: "space-between", cursor: u.userId ? "pointer" : "default", borderRadius: 8, padding: "2px 4px", background: on ? "#F0FAF8" : undefined }} role={u.userId ? "button" : undefined} tabIndex={u.userId ? 0 : undefined} title={`${nf(u.available)} of ${nf(u.calls)} calls recorded`} onClick={() => u.userId && apply({ ...f, agent: on ? "" : u.userId })} onKeyDown={(e) => e.key === "Enter" && u.userId && apply({ ...f, agent: on ? "" : u.userId })}>
                      <span className="who"><span className="av">{initials(u.name)}</span><span style={on ? { fontWeight: 700, color: "#0F766E" } : undefined}>{u.name}</span></span>
                      <span className="row">
                        <span className={u.calls && u.coverage < 90 ? "dn" : "mut"} style={{ fontSize: 13 }}>{u.calls ? `${u.coverage}%` : "—"}</span>
                        <span className={u.available ? "sv3-rsw" : "sv3-rsw off"} role="img" aria-label={u.available ? "Recording on" : "Recording off"} />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="also"><b style={{ color: "#0F1E2B" }}>Not repeated here:</b><a href="/sales-v3/reports">Answered calls &amp; talk time → Call Reports</a></div>

      {play && <RecordingModal row={play} onClose={() => setPlay(null)} />}
    </>
  );
}
