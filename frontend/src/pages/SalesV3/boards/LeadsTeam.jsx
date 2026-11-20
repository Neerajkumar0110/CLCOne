import React, { useMemo, useState } from "react";
import { message } from "antd";
import { request } from "@/request";
import { usePoll } from "@/pages/Calling/shared";
import { Modal, Skel, nf, initials, fmtDay, stageBadge } from "../ui";
import { AgentLnk } from "../popups/Popups";

// v3 design — S3TeamActivity. Data: GET calling/team-activity (every 15 s),
// POST calling/team-activity/:id/pool {on}, POST …/:id/auto-start {off}.
const NOW = {
  Available: ["Waiting for call", "b tl"],
  Ringing: ["Ringing", "b bl"],
  OnCall: ["On a call", "b gr"],
  Wrapup: ["Wrap-up", "b gy"],
  Paused: ["On break", "b or"],
};
const hms = (s) => {
  const m = Math.round((s || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};
const ago = (d) => {
  if (!d) return "never";
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
};

export default function LeadsTeam() {
  const [rows, setRows] = useState(null);
  const [days, setDays] = useState([]);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [show, setShow] = useState("");
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
    const r = await request.get({ entity: "calling/team-activity" });
    if (r?.success) {
      setRows(r.result);
      setDays(r.days || []);
    } else if (!rows) setRows([]);
  };
  usePoll(load, 15000, []);

  const setPool = async (u, on) => {
    setBusy(u._id);
    const r = await request.post({ entity: `calling/team-activity/${u._id}/pool`, jsonData: { on } });
    if (r?.success) message.success(r.message);
    else message.error(r?.message || "Could not change the pool status.");
    await load();
    setBusy(null);
    setConfirm(null);
  };
  const setAuto = async (u, off) => {
    setBusy(u._id);
    setRows((rs) => rs.map((x) => (x._id === u._id ? { ...x, autoStart: { ...x.autoStart, off } } : x)));
    const r = await request.post({ entity: `calling/team-activity/${u._id}/auto-start`, jsonData: { off } });
    if (r?.success) message.success(r.message);
    else message.error(r?.message || "Could not change the auto-start.");
    await load();
    setBusy(null);
  };

  const roles = useMemo(() => [...new Set((rows || []).map((u) => u.role))].sort(), [rows]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows || []).filter((u) => {
      if (role && u.role !== role) return false;
      if (show === "pool" && !u.pool.on) return false;
      if (show === "nopool" && u.pool.on) return false;
      if (show === "online" && !u.online) return false;
      if (n && ![u.name, u.email, u.phone, u.role].some((v) => String(v || "").toLowerCase().includes(n))) return false;
      return true;
    });
  }, [rows, q, role, show]);
  const all = rows || [];
  const inState = (k) => all.filter((u) => u.pool.on && u.pool.status === k).length;
  const live = [
    ["Online now", all.filter((u) => u.online).length, "#0F766E", "#E6F4F2", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"],
    ["On a call", inState("OnCall"), "#16A34A", "#E8F7EE", "M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4l2.8.7a2 2 0 0 1 1.7 2z"],
    ["Ringing", inState("Ringing"), "#2563EB", "#EAF1FE", "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"],
    ["Waiting for call", inState("Available"), "#0F766E", "#E6F7F4", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2"],
    ["Wrap-up", inState("Wrapup"), "#475467", "#EEF2F6", "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l2 2 4-4"],
    ["On break", inState("Paused"), "#EA580C", "#FEF0E6", "M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v3M10 2v3M14 2v3"],
  ];

  return (
    <>
      <div className="kpis">
        {live.map(([l, v, c, bg, d]) => (
          <div key={l} className="kpi">
            <div className="l"><i style={{ background: bg, color: c }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg></i>{l}{v > 0 && <span className="sv3-pulse" style={{ background: c }} aria-hidden="true" />}</div>
            <div className="v">{rows ? v : <span className="skel" style={{ display: "block", height: 26, width: "60%" }} />}</div>
          </div>
        ))}
      </div>

      <section className="fp">
        <div className="row">
          <label className="srch">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5B6B79" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
            <input type="search" placeholder="Search name, email, phone…" aria-label="Search team" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select className="sel" style={{ width: "auto" }} aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All roles</option>
            {roles.map((r) => <option key={r}>{r}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Show">
            {[["", "Everyone"], ["online", "Online now"], ["pool", "In Lead Pool"], ["nopool", "Not in Lead Pool"]].map(([k, l]) => (
              <button key={k || "all"} type="button" className={show === k ? "on" : ""} onClick={() => setShow(k)}>{l}</button>
            ))}
          </div>
        </div>
      </section>

      {!rows ? (
        <Skel h={320} />
      ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th scope="col">Profile</th><th scope="col">Now</th><th scope="col">Last seen</th><th scope="col">Logged in today</th>
                <th scope="col" className="num">Calls today</th><th scope="col" className="num">Connected</th><th scope="col" className="num">Talk time</th><th scope="col" className="num">Breaks</th>
                <th scope="col" className="num">Pool time</th><th scope="col">Lead Pool</th><th scope="col">Skip auto-start</th>
                <th scope="col"><span style={{ position: "absolute", left: -9999 }}>More</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={12}><div className="state"><b>No users match.</b></div></td></tr>}
              {shown.map((u) => {
                const open = openId === u._id;
                const now = u.pool.on ? NOW[u.pool.status] || [u.pool.status, "b gy"] : u.online ? ["Online · not in pool", "b gy"] : ["Offline", "b gy"];
                const as = u.autoStart || {};
                const skipOn = !!as.onLeave || !!as.off;
                const maxDay = Math.max(3600, ...(u.days || []).map((d) => d.loginSeconds || 0));
                return (
                  <React.Fragment key={u._id}>
                    <tr>
                      <td>
                        <span className="who">
                          <span className="av">{initials(u.name)}</span>
                          <span><AgentLnk adminId={u._id} name={u.name} /><div className="mut" style={{ fontSize: 12 }}>{[u.businessName || u.businessSegment || u.role, u.phone].filter(Boolean).join(" · ")}</div></span>
                        </span>
                      </td>
                      <td><span className={now[1]}>{now[0]}</span></td>
                      <td className="mut">{u.online ? "online now" : ago(u.lastSeenAt)}</td>
                      <td>{u.today?.loginSeconds ? hms(u.today.loginSeconds) : "Not today"}</td>
                      <td className="num">{nf(u.today?.calls)}</td>
                      <td className="num">{nf(u.today?.connected)}</td>
                      <td className="num">{u.today?.talkSeconds ? hms(u.today.talkSeconds) : "—"}</td>
                      <td className="num" title={u.pool.breaksTakenToday ? `${u.pool.breaksTakenToday} breaks` : undefined}>{u.pool.breakMinutesToday ? `${u.pool.breakMinutesToday}m` : "—"}</td>
                      <td className="num">{u.pool.minutesToday ? hms(u.pool.minutesToday * 60) : "—"}</td>
                      <td>
                        {u.phone || u.pool.on ? (
                          <button type="button" className={u.pool.on ? "sv3-sw on" : "sv3-sw"} role="switch" aria-checked={!!u.pool.on} aria-label={`${u.name} in Lead Pool`} disabled={busy === u._id} onClick={() => (u.pool.on ? setConfirm(u) : setPool(u, true))} />
                        ) : (
                          <span className="b gy" title="Not set — can’t join the pool">No phone</span>
                        )}
                      </td>
                      <td>
                        <button type="button" className={skipOn ? "sv3-sw on" : "sv3-sw"} role="switch" aria-checked={skipOn} aria-label={`Skip ${u.name}'s auto-start`} disabled={busy === u._id || !!as.onLeave} title={as.onLeave ? "On leave today — the dialer never auto-starts" : "Skip the auto-start"} onClick={() => setAuto(u, !as.off)} />
                      </td>
                      <td><button type="button" className="ib" aria-label={open ? "Hide details" : "Show details"} aria-expanded={open} onClick={() => setOpenId(open ? null : u._id)}>{open ? "▾" : "▸"}</button></td>
                    </tr>
                    {open && (
                      <tr className="ex">
                        <td colSpan={12} style={{ whiteSpace: "normal" }}>
                          <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 20 }}>
                            <div>
                              <b style={{ fontSize: 13 }}>Login hours, last 7 days</b> <span className="mut" style={{ fontSize: 12 }}>· week total {hms(u.week?.loginSeconds)}</span>
                              <div className="sv3-wk">
                                {(u.days || []).map((d) => (
                                  <div key={d.day} title={`${d.day}: ${hms(d.loginSeconds)} logged in, ${d.calls} calls`}>
                                    <b style={{ height: `${Math.max(6, ((d.loginSeconds || 0) / maxDay) * 100)}%`, background: d.loginSeconds ? "#0F766E" : "#CFD8E1" }} />
                                    {new Date(`${d.day}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short" })}
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="kv" style={{ gridTemplateColumns: "110px 1fr", fontSize: 13 }}>
                              <span>Email</span><span>{u.email || "—"}</span>
                              <span>Phone</span><span>{u.phone || "—"}</span>
                              <span>Joined CRM</span><span>{u.joined ? fmtDay(u.joined) : "—"}</span>
                              <span>Business</span><span>{u.businessName || u.businessSegment || "—"}</span>
                            </div>
                            <div>
                              <b style={{ fontSize: 13 }}>Leads assigned</b>
                              <div className="row" style={{ marginTop: 8, gap: 6 }}>
                                {Object.entries(u.leads?.byStage || {}).sort((a, b) => b[1] - a[1]).map(([s, n]) => <span key={s} className={stageBadge(s)}>{s.replace(/ Leads?$/, "")} {nf(n)}</span>)}
                                {!Object.keys(u.leads?.byStage || {}).length && <span className="mut">None</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirm && (
        <Modal
          title={`Take ${confirm.name} out of the Lead Pool?`}
          sub="They’ll stop receiving calls"
          onClose={() => setConfirm(null)}
          width={460}
          footer={<><button type="button" className="btn g" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="btn d" disabled={busy === confirm._id} onClick={() => setPool(confirm, false)}>Take out</button></>}
        >
          <div className="mut">The auto-dialer stops sending them calls until they — or you — switch it on again.</div>
        </Modal>
      )}
    </>
  );
}
