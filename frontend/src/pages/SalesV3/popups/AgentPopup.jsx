import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import dayjs from "dayjs";
import { request } from "@/request";
import { initials, talk, hm, IST } from "../ui";

// v3 design — S3AgentPopup: one Sales user's whole day, minute by minute.
// Data: GET workday/admin/timeline?adminId&date (session, activity events,
// calls, responses). Name only (no id)? → matched against today's
// workday/admin/360 rows. The backend decides whose day a viewer may see.
const connected = (c) => !!(c.answeredAt && c.agentLegAnswered !== false && c.duration > 0);
const clock = (v) => (v ? new Date(v).toLocaleTimeString("en-IN", { ...IST, hour: "numeric", minute: "2-digit" }) : "—");
const KIND = {
  shift_login: ["Login", "#0F766E", "b tl"],
  shift_logout: ["Logout", "#475467", "b gy"],
  auto_start: ["Auto start", "#0F766E", "b tl"],
  pool_on: ["Dialer on", "#5EC4B6", "b gr"],
  pool_off: ["Dialer off", "#94A3B8", "b gy"],
  break_start: ["Break", "#EA580C", "b or"],
  break_end: ["Break end", "#EA580C", "b or"],
  marked_present: ["Present", "#0F766E", "b tl"],
};
const kindOf = (k) => KIND[k] || (String(k || "").startsWith("leave") ? ["Leave", "#2563EB", "b bl"] : [String(k || "Activity").replace(/_/g, " "), "#5B6B79", "b gy"]);

export default function AgentPopup({ adminId, name, onClose, onLead }) {
  const [id, setId] = useState(adminId ? String(adminId) : "");
  const [dayOff, setDayOff] = useState(0);
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [tab, setTab] = useState("timeline");
  const [type, setType] = useState("");
  const dayKey = dayjs().subtract(dayOff, "day").format("YYYY-MM-DD");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // name → adminId once
  useEffect(() => {
    if (id || !name) return undefined;
    let live = true;
    const range = { from: dayjs().subtract(30, "day").startOf("day").toISOString(), to: dayjs().toISOString() };
    request.get({ entity: `workday/admin/360?${new URLSearchParams(range)}` }).then((r) => {
      if (!live) return;
      const want = String(name).trim().toLowerCase();
      const hit = (r?.result?.people || r?.result?.rows || []).find((p) => String(p.name || "").trim().toLowerCase() === want);
      if (hit) setId(String(hit.adminId));
      else setState("missing");
    });
    return () => {
      live = false;
    };
  }, [id, name]);

  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    setState("loading");
    request.get({ entity: `workday/admin/timeline?adminId=${id}&date=${dayKey}` }).then((r) => {
      if (!live) return;
      if (r?.success) {
        setData(r.result);
        setState("data");
      } else setState(r?.message ? "denied" : "error");
    });
    return () => {
      live = false;
    };
  }, [id, dayKey]);

  const v = useMemo(() => {
    if (!data) return null;
    const s = data.session || {};
    const events = [...(data.events || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
    const calls = data.calls || [];
    const conn = calls.filter(connected);
    const talkSec = conn.reduce((t, c) => t + (c.duration || 0), 0);
    const end = s.logoutAt || (dayOff === 0 ? new Date().toISOString() : null);
    // dialer on → off spans
    const spans = [];
    let on = null;
    for (const e of events) {
      if (e.kind === "pool_on" && !on) on = e.at;
      else if (e.kind === "pool_off" && on) {
        spans.push([on, e.at]);
        on = null;
      }
    }
    if (on && end) spans.push([on, end]);
    const ms = (a, b) => Math.max(0, new Date(b) - new Date(a));
    const dialerMin = Math.round(spans.reduce((t, [a, b]) => t + ms(a, b), 0) / 60000);
    const breaks = (s.breaks || []).map((b) => ({ ...b, endAt: b.endAt || (dayOff === 0 ? new Date().toISOString() : b.startAt) }));
    const breakMin = Math.round(breaks.reduce((t, b) => t + ms(b.startAt, b.endAt), 0) / 60000);
    const firstLogin = s.loginAt || s.autoStartedAt || events.find((e) => e.kind === "shift_login")?.at || calls[0]?.created || null;
    const loggedMin = firstLogin && end ? Math.round(ms(firstLogin, end) / 60000) : 0;
    // strip window 9:00–20:00 widened to what happened
    const base = dayjs(dayKey);
    const pts = [firstLogin, end, ...calls.map((c) => c.created)].filter(Boolean).map((x) => new Date(x).getTime());
    const t0 = Math.min(base.hour(9).valueOf(), ...pts);
    const t1 = Math.max(base.hour(20).valueOf(), ...pts);
    const pos = (x) => ((new Date(x).getTime() - t0) / (t1 - t0)) * 100;
    const hours = [];
    for (let h = dayjs(t0).startOf("hour"); h.valueOf() <= t1; h = h.add(2, "hour")) hours.push(h.format("HH:mm"));
    // calls per hour
    const perHour = {};
    calls.forEach((c) => {
      const h = new Date(c.created).toLocaleTimeString("en-IN", { ...IST, hour: "2-digit", hour12: false });
      perHour[h] = perHour[h] || { n: 0, ok: 0 };
      perHour[h].n += 1;
      if (connected(c)) perHour[h].ok += 1;
    });
    const hourKeys = Object.keys(perHour).sort();
    // minute-by-minute feed
    const feed = [
      ...events.map((e) => ({ at: e.at, kind: e.kind, w: kindOf(e.kind)[0], d: e.detail || "", c: kindOf(e.kind)[1], bc: kindOf(e.kind)[2], k: kindOf(e.kind)[0] })),
      ...calls.map((c) => ({
        at: c.created,
        kind: "call",
        w: `${c.direction === "inbound" ? "Incoming" : "Call"} · ${c.contactName || c.phone || "—"}`,
        d: `${c.phone || ""} · ${c.status}${c.duration ? ` · ${talk(c.duration)}` : ""}${c.disposition ? ` · ${c.disposition}` : ""}`,
        c: connected(c) ? "#0B2230" : "#94A3B8",
        bc: connected(c) ? "b gr" : c.missedByAgent ? "b rd" : "b gy",
        k: connected(c) ? "Spoke" : c.missedByAgent ? "Missed" : "Call",
        phone: c.phone,
      })),
      ...(data.responses || []).map((r) => ({
        at: r.at,
        kind: "response",
        w: `Response · ${r.name || r.phone || "lead"}`,
        d: `${r.fromStage ? `${r.fromStage} → ` : ""}${r.toStage || ""}${r.toSubStatus ? ` · ${r.toSubStatus}` : ""}${r.remarks ? ` · ${r.remarks}` : ""}`,
        c: "#2563EB",
        bc: "b bl",
        k: "Response",
        phone: r.phone,
      })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));
    return { s, events, calls, conn, talkSec, spans, dialerMin, breaks, breakMin, firstLogin, loggedMin, pos, hours, perHour, hourKeys, feed, end };
  }, [data, dayKey, dayOff]);

  const shownName = data?.user?.name || name || "Sales user";
  const types = v ? [...new Set(v.feed.map((f) => f.k))] : [];
  const feed = v ? v.feed.filter((f) => !type || f.k === type) : [];
  const TABS = v
    ? [
        ["timeline", "Timeline", v.feed.length],
        ["calls", "Calls", v.calls.length],
        ["dialer", "Dialer sessions", v.spans.length],
        ["breaks", "Breaks", v.breaks.length],
        ["responses", "Responses", (data.responses || []).length],
      ]
    : [];
  const maxH = v ? Math.max(1, ...v.hourKeys.map((k) => v.perHour[k].n)) : 1;

  return createPortal(
    <div className="sv3">
      <div className="sv3-ap-ov" role="dialog" aria-modal="true" aria-label="Agent full details" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
        <div className="sv3-ap">
          <div className="sv3-ap-hd">
            <div className="sv3-ap-av">{initials(shownName)}</div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <h2>{shownName}</h2>
              <div className="chps">
                {data?.user?.role && <span className="chp">{data.user.role}</span>}
                {data?.user?.email && <span className="chp">✉ {data.user.email}</span>}
                {v && <span className="chp">{v.s.logoutAt ? "Logged out" : v.firstLogin ? "Working" : "Not started"}</span>}
              </div>
            </div>
            <div className="seg" role="group" aria-label="Day">
              {[[0, "Today"], [1, "Yesterday"], [2, dayjs().subtract(2, "day").format("D MMM")], [3, dayjs().subtract(3, "day").format("D MMM")]].map(([k, l]) => (
                <button key={k} type="button" className={dayOff === k ? "on" : ""} onClick={() => setDayOff(k)}>{l}</button>
              ))}
            </div>
            <button type="button" className="ib" onClick={onClose} aria-label="Close">✕</button>
          </div>

          <div className="sv3-ap-bd">
            {state === "loading" && <div className="skel" style={{ height: 260 }} />}
            {state === "missing" && <div className="state"><b>No activity found for {name}.</b></div>}
            {state === "denied" && <div className="state"><b>You can only see your own day.</b></div>}
            {state === "error" && <div className="state err"><b>Couldn’t load this day.</b></div>}
            {state === "data" && v && (
              <>
                <div className="sv3-ap-tiles">
                  {[
                    [clock(v.firstLogin), "First login"],
                    [v.s.logoutAt ? clock(v.s.logoutAt) : "—", v.s.logoutAt ? "Logout" : "Logout (still in)"],
                    [v.spans[0] ? clock(v.spans[0][0]) : "—", "Dialer first on"],
                    [v.spans.length ? clock(v.spans[v.spans.length - 1][1]) : "—", "Dialer last off"],
                    [hm(v.dialerMin), `Dialer on${v.loggedMin ? ` · ${Math.round((v.dialerMin / v.loggedMin) * 100)}%` : ""}`],
                    [`${hm(v.breakMin)} · ${v.breaks.length}`, "Breaks"],
                    [hm(v.loggedMin), "Logged in"],
                    [v.calls.length, "Calls"],
                    [`${v.conn.length} · ${v.calls.length ? Math.round((v.conn.length / v.calls.length) * 100) : 0}%`, "Connected"],
                    [talk(v.talkSec), "Talk time"],
                    [v.calls.filter((c) => c.missedByAgent).length, "Missed by agent"],
                    [(data.responses || []).length, "Responses"],
                    [v.dialerMin ? Math.round((v.calls.length / (v.dialerMin / 60)) * 10) / 10 : "—", "Calls / dialer hour"],
                  ].map(([b, l]) => (
                    <div key={l} className="sv3-ap-tl"><b>{b}</b><span>{l}</span></div>
                  ))}
                </div>

                <div>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <b style={{ fontSize: 13.5 }}>Whole day at a glance</b>
                    <div className="legend">
                      <span><i className="dot" style={{ background: "#5EC4B6" }} />Dialer on</span>
                      <span><i className="dot" style={{ background: "#EA580C" }} />Break</span>
                      <span><i className="dot" style={{ background: "#0B2230" }} />Call</span>
                      <span><i className="dot" style={{ background: "#EEF2F6", border: "1px solid #CFD8E1" }} />Logged in, dialer off</span>
                    </div>
                  </div>
                  <div className="sv3-ap-strip" role="img" aria-label="Day strip">
                    {v.firstLogin && v.end && <span style={{ left: `${v.pos(v.firstLogin)}%`, width: `${v.pos(v.end) - v.pos(v.firstLogin)}%`, background: "#E2E8F0" }} />}
                    {v.spans.map(([a, b]) => (
                      <span key={a} style={{ left: `${v.pos(a)}%`, width: `${Math.max(0.4, v.pos(b) - v.pos(a))}%`, background: "#5EC4B6" }} title={`Dialer on ${clock(a)}–${clock(b)}`} />
                    ))}
                    {v.breaks.map((b) => (
                      <span key={b.startAt} style={{ left: `${v.pos(b.startAt)}%`, width: `${Math.max(0.4, v.pos(b.endAt) - v.pos(b.startAt))}%`, background: "#EA580C" }} title={`${b.label || "Break"} ${clock(b.startAt)}–${clock(b.endAt)}`} />
                    ))}
                    {v.calls.map((c) => (
                      <i key={c._id} style={{ left: `${v.pos(c.created)}%`, background: connected(c) ? "#0B2230" : "#94A3B8" }} title={`${clock(c.created)} · ${c.contactName || c.phone || ""} · ${c.status}`} />
                    ))}
                  </div>
                  <div className="sv3-ap-axis">{v.hours.map((h) => <span key={h}>{h}</span>)}</div>
                </div>

                <div className="tabs" role="tablist" aria-label="Agent details">
                  {TABS.map(([k, l, n]) => (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "tab on" : "tab"} onClick={() => setTab(k)}>
                      {l} <span className="n">{n}</span>
                    </button>
                  ))}
                </div>

                {tab === "timeline" && (
                  <div className="sv3-ap-g">
                    <div className="sv3-ap-box">
                      <h4>
                        Everything, minute by minute
                        <select className="sel" style={{ width: "auto", minHeight: 34 }} aria-label="Activity type" value={type} onChange={(e) => setType(e.target.value)}>
                          <option value="">All activity types</option>
                          {types.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </h4>
                      {feed.length === 0 && <div className="state"><b>Nothing on this day.</b></div>}
                      {feed.map((e, i) => (
                        <div key={`${e.at}-${i}`} className="sv3-ap-ev">
                          <span className="mut">{clock(e.at)}</span>
                          <span className="d" style={{ background: e.c }} />
                          <span>
                            {e.phone && onLead ? <button type="button" className="lnk" onClick={() => onLead({ phone: e.phone })}>{e.w}</button> : <b>{e.w}</b>}
                            <small>{e.d}</small>
                          </span>
                          <span className={e.bc}>{e.k}</span>
                        </div>
                      ))}
                    </div>
                    <div className="sv3-ap-box">
                      <h4>Calls per hour <span className="legend"><span><i className="dot" style={{ background: "#0F766E" }} />Connected</span><span><i className="dot" style={{ background: "#CBD5E1" }} />Not connected</span></span></h4>
                      {v.hourKeys.length ? (
                        <>
                          <div className="sv3-ap-bars">
                            {v.hourKeys.map((k) => (
                              <div key={k} title={`${k}:00 · ${v.perHour[k].n} calls, ${v.perHour[k].ok} connected`}>
                                <i style={{ height: `${((v.perHour[k].n - v.perHour[k].ok) / maxH) * 100}%`, background: "#CBD5E1" }} />
                                <i style={{ height: `${(v.perHour[k].ok / maxH) * 100}%`, background: "#0F766E" }} />
                              </div>
                            ))}
                          </div>
                          <div className="sv3-ap-lbl">{v.hourKeys.map((k) => <span key={k}>{k}</span>)}</div>
                        </>
                      ) : (
                        <div className="state"><b>No calls on this day.</b></div>
                      )}
                    </div>
                  </div>
                )}

                {tab === "calls" && (
                  <div className="tw">
                    <table>
                      <thead><tr><th scope="col">Time</th><th scope="col">Customer</th><th scope="col">Number</th><th scope="col">Direction</th><th scope="col">Result</th><th scope="col" className="num">Talk</th><th scope="col">Disposition</th></tr></thead>
                      <tbody>
                        {v.calls.length === 0 && <tr><td colSpan={7}><div className="state"><b>No calls on this day.</b></div></td></tr>}
                        {v.calls.map((c) => (
                          <tr key={c._id}>
                            <td>{clock(c.created)}</td>
                            <td>{c.contactName || "—"}</td>
                            <td>{c.phone ? <button type="button" className="lnk" onClick={() => onLead?.({ phone: c.phone })}>{c.phone}</button> : "—"}</td>
                            <td>{c.direction || "—"}</td>
                            <td><span className={connected(c) ? "b gr" : c.missedByAgent ? "b rd" : "b gy"}>{connected(c) ? "Spoke" : c.missedByAgent ? "Missed by agent" : c.status}</span></td>
                            <td className="num">{c.duration ? talk(c.duration) : "—"}</td>
                            <td>{c.disposition || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {tab === "dialer" && (
                  <div className="sv3-ap-box">
                    {v.spans.length === 0 && <div className="state"><b>The dialer was not switched on this day.</b></div>}
                    {v.spans.map(([a, b]) => {
                      const inS = v.calls.filter((c) => new Date(c.created) >= new Date(a) && new Date(c.created) < new Date(b));
                      return (
                        <div key={a} className="sv3-ap-ev">
                          <span className="mut">{clock(a)}</span>
                          <span className="d" style={{ background: "#5EC4B6" }} />
                          <span><b>{clock(a)} → {clock(b)} · {hm((new Date(b) - new Date(a)) / 60000)}</b><small>{inS.length} calls · {inS.filter(connected).length} connected</small></span>
                          <span className="b gr">Dialer on</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {tab === "breaks" && (
                  <div className="sv3-ap-box">
                    {v.breaks.length === 0 && <div className="state"><b>No breaks on this day.</b></div>}
                    {v.breaks.map((b) => (
                      <div key={b.startAt} className="sv3-ap-ev">
                        <span className="mut">{clock(b.startAt)}</span>
                        <span className="d" style={{ background: "#EA580C" }} />
                        <span><b>{b.label || "Break"} · {hm((new Date(b.endAt) - new Date(b.startAt)) / 60000)}</b><small>{clock(b.startAt)} → {clock(b.endAt)}{b.plannedMin ? ` · planned ${b.plannedMin}m` : ""}</small></span>
                        <span className="b or">Break</span>
                      </div>
                    ))}
                  </div>
                )}

                {tab === "responses" && (
                  <div className="sv3-ap-box">
                    {(data.responses || []).length === 0 && <div className="state"><b>No responses on this day.</b></div>}
                    {(data.responses || []).map((r, i) => (
                      <div key={`${r.leadId}-${i}`} className="sv3-ap-ev">
                        <span className="mut">{clock(r.at)}</span>
                        <span className="d" style={{ background: "#2563EB" }} />
                        <span>
                          <button type="button" className="lnk" onClick={() => onLead?.({ phone: r.phone, lead: r.leadId ? { _id: r.leadId, name: r.name, phone: r.phone } : null })}>{r.name || r.phone || "Lead"}</button>
                          <small>{r.fromStage ? `${r.fromStage} → ` : ""}{r.toStage}{r.toSubStatus ? ` · ${r.toSubStatus}` : ""}{r.remarks ? ` · ${r.remarks}` : ""}</small>
                        </span>
                        <span className="b bl">Response</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="sv3-ap-ft">
            <button type="button" className="btn p" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
