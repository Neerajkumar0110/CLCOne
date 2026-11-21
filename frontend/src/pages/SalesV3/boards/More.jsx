import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { message } from "antd";
import { request } from "@/request";
import { subStatusesFor } from "@/config/leadStages";
import useBusinessLock from "@/hooks/useBusinessLock";
import { useCallingMeta, openTel, CAMPAIGN_TYPES, PRIORITIES } from "@/pages/Calling/shared";
import { Head, Modal, Pager, Skel, Empty, Fail, nf, fmtDay } from "../ui";
import { LeadLnk, AgentLnk } from "../popups/Popups";

// v3 design — S3More: Live Demos · Candidates · Calls Dashboard · Campaigns (+ C8 campaign
// edit + add lead). Each tab is its own sidebar item; the tab row switches between them.
//   demos      → calling/demos (+ /join for the host)
//   candidates → lead/by-stage?stage=Enrolled (counsellor = owner, enrolled on = enrolledAt)
//   callsdash  → analytics/calls/summary (this period and the one before, by day)
//   campaigns  → calling/campaigns (+ /:id/action, PATCH/POST, /:id/leads, /leads/import, manual dial)
const TABS = {
  demos: ["Live Demos", "Demo bookings and who joined."],
  candidates: ["Candidates", "Enrolled students and their counsellor."],
  callsdash: ["Calls Dashboard", "Are calls going up or down?"],
  campaigns: ["Campaigns", "Set up and run calling campaigns."],
};

// ── Live Demos ─────────────────────────────────────────────────────────
const DEMO = { booked: ["Booked", "b bl"], attended: ["Joined", "b gr"], missed: ["Missed twice", "b rd"], cancelled: ["Cancelled", "b gy"] };
const WINDOW = { early: "Opens for customers at 5:50 PM", open: "Open now — customers can join", over: "Today's demo is over", none: "No demo today (Sunday)" };
function Demos() {
  const [d, setD] = useState({ data: null, loading: true, error: false });
  const [joining, setJoining] = useState(false);
  const [day, setDay] = useState("");
  const load = () => request.get({ entity: "calling/demos" }).then((r) => setD(r?.success ? { data: r.result, loading: false, error: false } : { data: null, loading: false, error: true }));
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  const items = d.data?.items || [];
  const days = useMemo(() => [...new Set(items.map((b) => b.date))].sort((a, b) => (a < b ? 1 : -1)), [items]);
  const rows = items.filter((b) => !day || b.date === day).sort((a, b) => (a.date < b.date ? 1 : -1));
  const cnt = (s) => items.filter((b) => b.status === s).length;
  const joinHost = async () => {
    setJoining(true);
    const r = await request.get({ entity: "calling/demos/join" });
    setJoining(false);
    if (r?.success && r.result?.url) window.open(r.result.url, "_blank", "noopener");
    else message.error(r?.message || "Could not open the room.");
  };
  const copy = (link) => navigator.clipboard?.writeText(link).then(() => message.success("Customer link copied"));
  const dayLabel = (k) => (k === d.data?.today ? "Today 6 PM" : dayjs(k).format("D MMM"));
  return (
    <>
      <div className="kpis">
        {[["Booked", cnt("booked")], ["Joined", cnt("attended")], ["Cancelled", cnt("cancelled")], ["Missed twice", cnt("missed")]].map(([l, v]) => (
          <div key={l} className="kpi"><div className="l">{l}</div><div className="v">{d.loading ? <span className="skel" style={{ display: "block", height: 26, width: "50%" }} /> : nf(v)}</div></div>
        ))}
      </div>
      <div className="card">
        <div className="ch">
          <div><h3>Live Demo — Mon–Sat, 6:00–7:00 PM</h3><p>{d.data ? <>Today: <b>{WINDOW[d.data.todayWindow] || ""}</b>{d.data.todayLive ? " · ● Live" : ""}</> : "Same list, same copy-link and status actions"}</p></div>
          <div className="row">
            <select className="sel" style={{ width: "auto", minHeight: 36 }} aria-label="Demo day" value={day} onChange={(e) => setDay(e.target.value)}>
              <option value="">All days</option>
              {days.map((k) => <option key={k} value={k}>{dayjs(k).format("ddd, D MMM")}{k === d.data?.today ? " · today" : ""}</option>)}
            </select>
            {d.data?.todayIsDemoDay && <button type="button" className="btn sm p" disabled={joining} onClick={joinHost}>{joining ? "Opening…" : "Join as host"}</button>}
            <span className="src">calling/demos · demos/status</span>
          </div>
        </div>
        {d.error ? <Fail onRetry={load} /> : d.loading ? <Skel h={200} /> : !rows.length ? <Empty /> : (
          <div className="tw">
            <table>
              <thead><tr><th scope="col">Lead</th><th scope="col">Booked by</th><th scope="col">Demo day</th><th scope="col">Status</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th></tr></thead>
              <tbody>
                {rows.map((b) => {
                  const st = DEMO[b.status] || DEMO.booked;
                  return (
                    <tr key={b._id}>
                      <td><LeadLnk phone={b.phone} ink>{b.name || "—"}</LeadLnk><div className="mut" style={{ fontSize: 12 }}>{b.phone}{b.email ? ` · ${b.email}` : " · no email"}</div></td>
                      <td>{b.agentName ? <AgentLnk name={b.agentName} /> : "—"}{b.teamLeaderName && <div className="mut" style={{ fontSize: 12 }}>TL: {b.teamLeaderName}</div>}</td>
                      <td>{dayLabel(b.date)}{b.rebookCount > 0 && <div className="mut" style={{ fontSize: 12 }}>moved from {(b.missedDates || []).map((x) => dayjs(x).format("D MMM")).join(", ")}</div>}</td>
                      <td><span className={st[1]}>{st[0]}</span>{b.attendedAt && <div className="mut" style={{ fontSize: 12 }}>{dayjs(b.attendedAt).format("h:mm A")}</div>}</td>
                      <td>{b.customerLink && <button type="button" className="btn sm" onClick={() => copy(b.customerLink)}>Copy join link</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Candidates ─────────────────────────────────────────────────────────
// A sales agent sees only the candidates they own (Counsellor = them); managers see everyone.
function Candidates({ ownOnly = false }) {
  const subs = subStatusesFor("Enrolled") || [];
  const BL = { q: "", sub: "", owner: "" };
  const [draft, setDraft] = useState(BL);
  const [f, setF] = useState(BL);
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(20);
  const [d, setD] = useState({ rows: [], count: 0, pages: 1, loading: true, error: false });
  const [owners, setOwners] = useState([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // admin/list (there is no admin/listAll route — it showed "Api url doesn't exist"); only managers pick a counsellor.
    if (ownOnly) return;
    request.list({ entity: "admin", options: { items: 500 } }).then((r) => setOwners(((r && r.result) || []).filter((a) => a.enabled !== false && a.role !== "Student" && a.role !== "Teacher")));
  }, [ownOnly]);
  useEffect(() => {
    let live = true;
    setD((x) => ({ ...x, loading: true, error: false }));
    const p = new URLSearchParams({ stage: "Enrolled", page: String(page), items: String(per), pool: "all" });
    if (f.q) p.set("q", f.q);
    if (f.sub) p.set("subStatus", f.sub);
    if (ownOnly) p.set("teamView", "mine");
    else if (f.owner) p.set("assignedUser", f.owner);
    request.get({ entity: `lead/by-stage?${p}` }).then((r) => {
      if (!live) return;
      setD(r?.success ? { rows: r.result || [], count: r.pagination?.count || 0, pages: r.pagination?.pages || 1, loading: false, error: false } : { rows: [], count: 0, pages: 1, loading: false, error: true });
    });
    return () => {
      live = false;
    };
  }, [f, page, per, tick, ownOnly]);
  const apply = (n) => {
    setF(n);
    setDraft(n);
    setPage(1);
  };
  const name = (a) => [a.name, a.surname].filter(Boolean).join(" ");
  return (
    <>
      <section className="fp" aria-label="Filters">
        <div className="fgrid">
          <label className="fld">Search<input className="in" placeholder="Name, email, phone…" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && apply({ ...draft, q: e.currentTarget.value })} /></label>
          <label className="fld">Status
            <select className="sel" value={draft.sub} onChange={(e) => setDraft({ ...draft, sub: e.target.value })}><option value="">All</option>{subs.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          {!ownOnly && <label className="fld">Counsellor
            <select className="sel" value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })}><option value="">All</option>{owners.map((a) => <option key={a._id} value={a._id}>{name(a)}</option>)}</select>
          </label>}
        </div>
        <div className="factions"><span className="mut" style={{ fontSize: 12.5 }}>{d.loading ? "Loading…" : `${nf(d.count)} candidates`}</span><div className="row"><button type="button" className="btn g" onClick={() => apply(BL)}>Reset</button><button type="button" className="btn p" onClick={() => apply(draft)}>Apply</button></div></div>
      </section>
      <div className="tw">
        <table>
          <thead><tr><th scope="col">Candidate</th><th scope="col">Counsellor</th><th scope="col">Status</th><th scope="col">Enrolled on</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th></tr></thead>
          <tbody>
            {d.loading && [0, 1, 2, 3].map((i) => <tr key={i}><td colSpan={5}><div className="skel" style={{ height: 22 }} /></td></tr>)}
            {!d.loading && d.rows.map((l) => (
              <tr key={l._id}>
                <td><b>{l.name || "—"}</b><div className="mut" style={{ fontSize: 12 }}>{[l.phone, l.email].filter(Boolean).join(" · ")}</div></td>
                <td>{l.assignedUserName || l.assignedUser?.name ? <AgentLnk adminId={l.assignedUser?._id || (typeof l.assignedUser === "string" ? l.assignedUser : "")} name={l.assignedUserName || l.assignedUser?.name} /> : "—"}</td>
                <td><span className="b gr">{l.subStatus || "Enrolled"}</span></td>
                <td>{fmtDay(l.enrolledAt || l.updated || l.created)}</td>
                <td><LeadLnk lead={l} phone={l.phone}><span className="btn sm">View</span></LeadLnk></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!d.loading && d.error && <Fail onRetry={() => setTick((x) => x + 1)} />}
      {!d.loading && !d.error && !d.rows.length && (ownOnly ? <Empty text="No candidates in your name yet." sub={<span>A candidate shows here once you are its counsellor (the lead owner) when it is enrolled.</span>} /> : <Empty />)}
      {d.count > 0 && <Pager page={page} pages={d.pages} count={d.count} per={per} pers={[10, 20, 50]} onPer={(n) => { setPer(n); setPage(1); }} onPage={setPage} noun="candidates" />}
    </>
  );
}

// ── Calls Dashboard ────────────────────────────────────────────────────
function CallsDash() {
  const lock = useBusinessLock();
  const [period, setPeriod] = useState("week");
  const [biz, setBiz] = useState(lock ? String(lock).toLowerCase() : "all");
  const [d, setD] = useState({ cur: null, prev: null, loading: true, error: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setD((x) => ({ ...x, loading: true, error: false }));
    const now = dayjs();
    const start = period === "week" ? (now.day() === 0 ? now.subtract(6, "day") : now.startOf("week").add(1, "day")).startOf("day") : now.startOf("month");
    const pStart = period === "week" ? start.subtract(1, "week") : start.subtract(1, "month");
    const pEnd = period === "week" ? pStart.add(6, "day").endOf("day") : start.subtract(1, "millisecond");
    const q = (a, b) => new URLSearchParams({ from: a.toISOString(), to: b.toISOString(), ...(biz !== "all" ? { businessType: biz } : {}) });
    const curEnd = period === "week" ? start.add(6, "day").endOf("day") : now.endOf("month");
    Promise.all([request.get({ entity: `analytics/calls/summary?${q(start, now)}` }), request.get({ entity: `analytics/calls/summary?${q(pStart, pEnd)}` })]).then(([a, b]) => {
      if (!live) return;
      if (!a?.success) return setD({ cur: null, prev: null, loading: false, error: true });
      setD({ cur: a.result, prev: b?.success ? b.result : null, start, curEnd, pStart, loading: false, error: false });
    });
    return () => {
      live = false;
    };
  }, [period, biz, tick]);
  const series = (r) => (r?.kpis || []).find((k) => k.key === "total")?.series || [];
  const cs = series(d.cur);
  const ps = series(d.prev);
  const n = Math.max(cs.length, ps.length, period === "week" ? 7 : 1);
  const mx = Math.max(1, ...cs, ...ps);
  const X = (i) => (n <= 1 ? 375 : 60 + (i * 630) / (n - 1));
  const Y = (v) => Math.round(190 - ((v || 0) / mx) * 160);
  const pts = (arr) => arr.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const lbl = (i) => (d.start ? (period === "week" ? d.start.add(i, "day").format("ddd") : d.start.add(i, "day").format("D")) : "");
  const every = Math.max(1, Math.ceil(n / 10));
  const tot = (r) => (r?.kpis || []).find((k) => k.key === "total")?.value || 0;
  return (
    <>
      <section className="fp">
        <div className="row">
          <div className="seg" role="group" aria-label="Period">
            <button type="button" className={period === "week" ? "on" : ""} onClick={() => setPeriod("week")}>This week vs last</button>
            <button type="button" className={period === "month" ? "on" : ""} onClick={() => setPeriod("month")}>This month vs last</button>
          </div>
          <div className="seg" role="group" aria-label="Business">
            {[["all", "All"], ["b2b", "B2B"], ["b2c", "B2C"]].filter(([k]) => !lock || k === String(lock).toLowerCase()).map(([k, l]) => <button key={k} type="button" className={biz === k ? "on" : ""} onClick={() => setBiz(k)}>{l}</button>)}
          </div>
          <span className="sp" />
          {d.cur && <span className="mut" style={{ fontSize: 12.5 }}>{nf(tot(d.cur))} calls · before {nf(tot(d.prev))}</span>}
        </div>
      </section>
      <div className="card">
        <div className="ch"><div><h3>Calls per day — this period vs last</h3><p>Line chart · trends only (totals are in Call Reports)</p></div><span className="src">analytics/calls (existing dashboard shell)</span></div>
        {d.error ? <Fail onRetry={() => setTick((x) => x + 1)} /> : d.loading ? <Skel h={220} /> : !cs.some(Boolean) && !ps.some(Boolean) ? <Empty /> : (
          <svg viewBox="0 0 720 220" width="100%" height="220" role="img" aria-label="Calls per day compared with previous period">
            <line x1="40" y1="190" x2="710" y2="190" stroke="#CFD8E1" />
            <polyline points={pts(ps)} fill="none" stroke="#94A3B8" strokeWidth="2.5" strokeDasharray="6 5" />
            <polyline points={pts(cs)} fill="none" stroke="#0F766E" strokeWidth="3" />
            {Array.from({ length: n }, (_, i) => (
              <g key={i}>
                <circle cx={X(i)} cy={Y(cs[i])} r="9" fill="transparent"><title>{`${lbl(i)} · this period ${nf(cs[i] || 0)} · previous ${nf(ps[i] || 0)}`}</title></circle>
                {i % every === 0 && <text x={X(i)} y="208" fontSize="11" fill="#5B6B79" textAnchor="middle">{lbl(i)}</text>}
              </g>
            ))}
          </svg>
        )}
        <div className="legend"><span><i className="dot" style={{ background: "#0F766E" }} />This period</span><span><i className="dot" style={{ background: "#94A3B8" }} />Previous period</span></div>
      </div>
      <div className="also"><b style={{ color: "#0F1E2B" }}>Moved, not lost:</b><a href="/sales-v3/reports">KPI tiles, calls by agent, status split → Call Reports</a><a href="/sales-v3/history">Calls table → Call History</a></div>
    </>
  );
}

// ── Campaigns (+ C8 edit + add lead) ───────────────────────────────────
const NON_SALES = ["Support", "Finance", "Teacher", "Student"];
const C_BLANK = { name: "", description: "", campaignType: "Outbound", team: "", agents: [], startDate: "", endDate: "", callingHoursStart: "10:00", callingHoursEnd: "20:00", priority: "Normal", callerId: "", dialRatio: 1 };
const C_ST = { Active: ["Running", "b gr"], Paused: ["Paused", "b or"], Draft: ["Draft", "b gy"], Scheduled: ["Scheduled", "b bl"], Completed: ["Completed", "b tl"], Cancelled: ["Cancelled", "b rd"] };

function CampaignModal({ campaign, meta, onClose, onSaved }) {
  const [f, setF] = useState(campaign);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState({ name: "", phone: "", email: "", company: "", source: "Manual", notes: "" });
  const [adding, setAdding] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const toggle = (id) => setF((s) => ({ ...s, agents: s.agents.includes(id) ? s.agents.filter((x) => x !== id) : [...s.agents, id] }));
  const save = async () => {
    setBusy(true);
    const payload = { ...f, dialRatio: Number(f.dialRatio) || 1 };
    const r = f._id ? await request.patch({ entity: `calling/campaigns/${f._id}`, jsonData: payload }) : await request.post({ entity: "calling/campaigns", jsonData: payload });
    setBusy(false);
    if (r?.success) {
      message.success("Campaign saved.");
      onSaved();
    } else message.error(r?.message || "Could not save the campaign.");
  };
  const addLead = async () => {
    setAdding(true);
    const r = await request.post({ entity: `calling/campaigns/${f._id}/leads`, jsonData: add });
    setAdding(false);
    if (r?.success) {
      message.success("Lead added.");
      setAdd({ name: "", phone: "", email: "", company: "", source: "Manual", notes: "" });
    } else message.error(r?.message || "Could not add the lead.");
  };
  const callAdd = async () => {
    const r = await request.post({ entity: "calling/manual/dial", jsonData: { phone: add.phone, contactName: add.name, campaign: f._id } });
    if (r?.success) r.result?.tel && openTel(r.result.tel);
    else message.error(r?.message || "Could not start the call.");
  };
  const addWhy = !add.name.trim() ? "name" : add.phone.replace(/\D/g, "").length < 8 ? "phone" : "";
  return (
    <Modal title={f._id ? `Edit — ${campaign.name}` : "New campaign"} sub="Fields, team, agents, calling window — same as today" onClose={onClose} width={760} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn p" disabled={busy || !f.name.trim()} onClick={save}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="fgrid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        <label className="fld">Name <span className="req">*</span><input className="in" value={f.name} onChange={set("name")} /></label>
        <label className="fld">Team<select className="sel" value={f.team} onChange={set("team")}><option value="">— none —</option>{(meta.teams || []).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}</select></label>
        <label className="fld">Type<select className="sel" value={f.campaignType} onChange={set("campaignType")}>{CAMPAIGN_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="fld">Priority<select className="sel" value={f.priority} onChange={set("priority")}>{PRIORITIES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="fld">Calling window — from<input className="in" type="time" value={f.callingHoursStart} onChange={set("callingHoursStart")} /></label>
        <label className="fld">Calling window — to<input className="in" type="time" value={f.callingHoursEnd} onChange={set("callingHoursEnd")} /></label>
        <label className="fld">Start date<input className="in" type="date" value={(f.startDate || "").slice(0, 10)} onChange={set("startDate")} /></label>
        <label className="fld">End date<input className="in" type="date" value={(f.endDate || "").slice(0, 10)} onChange={set("endDate")} /></label>
        <label className="fld">Caller ID<input className="in" placeholder="+91…" value={f.callerId} onChange={set("callerId")} /></label>
      </div>
      <label className="fld" style={{ marginTop: 10 }}>Description<textarea className="in" rows={2} value={f.description} onChange={set("description")} /></label>
      <div className="fld" style={{ marginTop: 10 }}>Agents <span className="mut" style={{ fontWeight: 400 }}>· Sales agents only</span>
        <div className="row" style={{ gap: 6, marginTop: 6, maxHeight: 150, overflowY: "auto" }}>
          {(meta.agents || []).filter((a) => !NON_SALES.includes(a.role)).map((a) => (
            <label key={a._id} className={f.agents.includes(a._id) ? "pill" : "pill sv3-off"} style={{ cursor: "pointer" }}><input type="checkbox" checked={f.agents.includes(a._id)} onChange={() => toggle(a._id)} style={{ marginRight: 6 }} />{a.name}</label>
          ))}
        </div>
      </div>
      <p className="mut" style={{ fontSize: 12 }}>Dial pacing: progressive — one call per free agent, nothing goes out while every agent is busy.</p>
      {f._id && (
        <div className="card" style={{ background: "#F8FAFC", marginTop: 6 }}>
          <h4 style={{ margin: "0 0 8px" }}>Add lead to this campaign</h4>
          <div className="fgrid">
            <label className="fld">Name<input className="in" placeholder="Search name…" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></label>
            <label className="fld">Phone<input className="in" placeholder="+91…" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} /></label>
            <label className="fld">Email<input className="in" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></label>
            <label className="fld">Company<input className="in" value={add.company} onChange={(e) => setAdd({ ...add, company: e.target.value })} /></label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn sm" disabled={adding || !!addWhy} title={addWhy ? `Enter the ${addWhy}` : undefined} onClick={addLead}>{adding ? "Adding…" : "Add lead"}</button>
            <button type="button" className="btn sm" disabled={add.phone.replace(/\D/g, "").length < 8} onClick={callAdd}>Call from your phone</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CampaignLeads({ campaign, canManage, onClose }) {
  const [page, setPage] = useState(1);
  const [st, setSt] = useState("");
  const [q, setQ] = useState("");
  const [d, setD] = useState({ rows: [], pages: 1, count: 0, loading: true });
  const [imp, setImp] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setD((x) => ({ ...x, loading: true }));
    const p = new URLSearchParams({ page: String(page), items: "25" });
    if (st) p.set("status", st);
    if (q) p.set("q", q);
    request.get({ entity: `calling/campaigns/${campaign._id}/leads?${p}` }).then((r) => live && setD({ rows: r?.success ? r.result || [] : [], pages: r?.pagination?.pages || 1, count: r?.pagination?.count || 0, loading: false }));
    return () => {
      live = false;
    };
  }, [page, st, q, tick, campaign._id]);
  const doImport = async (file) => {
    if (!file) return;
    setImp({ busy: true });
    const fd = new FormData();
    fd.append("file", file);
    const r = await request.post({ entity: `calling/campaigns/${campaign._id}/leads/import`, jsonData: fd });
    setImp(r?.success ? r.result : { error: r?.message || "Import failed" });
    if (r?.success) setTick((x) => x + 1);
  };
  const call = async (l) => {
    const r = await request.post({ entity: "calling/manual/dial", jsonData: { phone: l.phone, contactName: l.name, callLead: l._id, campaign: campaign._id } });
    if (r?.success) {
      r.result?.tel && openTel(r.result.tel);
      setTick((x) => x + 1);
    } else message.error(r?.message || "Could not start the call.");
  };
  const s = campaign.stats || {};
  return (
    <Modal title={campaign.name} sub={`${nf(s.totalLeads)} leads · ${nf(s.pending)} pending · ${nf(s.dialed)} dialled · ${nf(s.connected)} connected`} onClose={onClose} width={900} footer={<button type="button" className="btn p" onClick={onClose}>Close</button>}>
      <div className="row" style={{ marginBottom: 10 }}>
        <select className="sel" style={{ width: "auto" }} aria-label="Lead status" value={st} onChange={(e) => { setSt(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>{["New", "Queued", "Dialing", "Connected", "No Answer", "Busy", "Failed", "Completed", "Callback", "DNC"].map((v) => <option key={v}>{v}</option>)}
        </select>
        <label className="srch" style={{ flex: "0 1 260px" }}><input placeholder="Search…" aria-label="Search leads" onKeyDown={(e) => { if (e.key === "Enter") { setQ(e.currentTarget.value.trim()); setPage(1); } }} /></label>
        <span className="sp" />
        {canManage && <label className="btn sm" style={{ cursor: "pointer" }}>{imp?.busy ? "Importing…" : "Import CSV / Excel"}<input type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => doImport(e.target.files?.[0])} /></label>}
      </div>
      {imp && !imp.busy && <div className={imp.error ? "warn" : "ok"} style={{ marginBottom: 10 }}>{imp.error || `Imported ${imp.inserted} · ${imp.duplicates} duplicates · ${imp.invalid} invalid`}</div>}
      {d.loading ? <Skel h={200} /> : !d.rows.length ? <Empty text="No leads. Import a file or add one from Edit." /> : (
        <div className="tw">
          <table>
            <thead><tr><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Company</th><th scope="col">Source</th><th scope="col">Status</th><th scope="col" className="num">Attempts</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Call</span></th></tr></thead>
            <tbody>
              {d.rows.map((l) => (
                <tr key={l._id}>
                  <td><LeadLnk phone={l.phone} ink>{l.name}</LeadLnk></td><td>{l.phone}</td><td>{l.company || "—"}</td><td>{l.source || "—"}</td>
                  <td><span className="b gy">{l.status}</span></td><td className="num">{nf(l.attempts)}</td>
                  <td><button type="button" className="btn sm" onClick={() => call(l)}>Call</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.count > 0 && <Pager page={page} pages={d.pages} count={d.count} per={25} onPage={setPage} noun="leads" />}
    </Modal>
  );
}

function Campaigns({ modal, setModal }) {
  const meta = useCallingMeta();
  const canManage = meta.tier === "admin" || meta.tier === "manager";
  const [q, setQ] = useState("");
  const [qIn, setQIn] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [d, setD] = useState({ rows: [], count: 0, pages: 1, loading: true, error: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setD((x) => ({ ...x, loading: true, error: false }));
    const p = new URLSearchParams({ page: String(page), items: "20" });
    if (status) p.set("status", status);
    if (q) p.set("q", q);
    request.get({ entity: `calling/campaigns?${p}` }).then((r) => live && setD(r?.success ? { rows: r.result || [], count: r.pagination?.count || (r.result || []).length, pages: r.pagination?.pages || 1, loading: false, error: false } : { rows: [], count: 0, pages: 1, loading: false, error: true }));
    return () => {
      live = false;
    };
  }, [page, q, status, tick]);
  const act = async (c, action) => {
    const r = await request.post({ entity: `calling/campaigns/${c._id}/action`, jsonData: { action } });
    setModal(null);
    if (r?.success) setTick((x) => x + 1);
    else message.error(r?.message || "Could not do that.");
  };
  return (
    <>
      <div className="row">
        <label className="srch" style={{ flex: "0 1 360px" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B6B79" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
          <input placeholder="Search campaigns…" aria-label="Search campaigns" value={qIn} onChange={(e) => setQIn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setQ(qIn.trim()), setPage(1))} />
        </label>
        <button type="button" className="btn" onClick={() => { setQ(qIn.trim()); setPage(1); }}>Search</button>
        <select className="sel" style={{ width: "auto" }} aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>{["Draft", "Scheduled", "Active", "Paused", "Completed", "Cancelled"].map((s) => <option key={s} value={s}>{(C_ST[s] || [s])[0]}</option>)}
        </select>
      </div>
      <div className="tw">
        <table>
          <thead><tr><th scope="col">Campaign</th><th scope="col">Status</th><th scope="col" className="num">Leads</th><th scope="col" className="num">Dialled (lifetime)</th><th scope="col">Done</th><th scope="col">Window</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th></tr></thead>
          <tbody>
            {d.loading && [0, 1, 2].map((i) => <tr key={i}><td colSpan={7}><div className="skel" style={{ height: 22 }} /></td></tr>)}
            {!d.loading && d.rows.map((c) => {
              const s = c.stats || {};
              const done = s.totalLeads ? Math.round((((s.totalLeads || 0) - (s.pending || 0)) / s.totalLeads) * 100) : 0;
              const stt = C_ST[c.status] || [c.status, "b gy"];
              return (
                <tr key={c._id}>
                  <td><button type="button" className="lnk" onClick={() => setModal({ kind: "leads", c })}>{c.name}</button>{c.priority && c.priority !== "Normal" && <span className="b or" style={{ marginLeft: 6 }}>{c.priority}</span>}<div className="mut" style={{ fontSize: 12 }}>{c.campaignType} · {(c.agents || []).length} agents</div></td>
                  <td><span className={stt[1]}>{stt[0]}</span></td>
                  <td className="num">{nf(s.totalLeads)}</td>
                  <td className="num">{nf(s.dialed)}</td>
                  <td>{done}%<span className="sv3-mini"><b style={{ width: `${done}%` }} /></span></td>
                  <td>{c.callingHoursStart}–{c.callingHoursEnd}</td>
                  <td>
                    {canManage && (
                      <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                        {["Draft", "Scheduled", "Paused"].includes(c.status) && <button type="button" className="btn sm p" onClick={() => act(c, "start")}>Start</button>}
                        {c.status === "Active" && <button type="button" className="btn sm" onClick={() => act(c, "pause")}>Pause</button>}
                        {["Active", "Paused"].includes(c.status) && <button type="button" className="btn sm" onClick={() => setModal({ kind: "confirm", c, action: "complete" })}>Complete</button>}
                        {!["Completed", "Cancelled"].includes(c.status) && <button type="button" className="btn sm d" onClick={() => setModal({ kind: "confirm", c, action: "cancel" })}>Cancel</button>}
                        <button type="button" className="btn sm" onClick={() => setModal({ kind: "edit", c: { ...C_BLANK, ...c, agents: (c.agents || []).map((a) => a._id || a) } })}>Edit</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!d.loading && d.error && <Fail onRetry={() => setTick((x) => x + 1)} />}
      {!d.loading && !d.error && !d.rows.length && <Empty />}
      {d.count > 0 && <Pager page={page} pages={d.pages} count={d.count} per={20} onPage={setPage} noun="campaigns" />}

      {modal?.kind === "edit" && <CampaignModal campaign={modal.c} meta={meta} onClose={() => setModal(null)} onSaved={() => { setModal(null); setTick((x) => x + 1); }} />}
      {modal?.kind === "leads" && <CampaignLeads campaign={modal.c} canManage={canManage} onClose={() => { setModal(null); setTick((x) => x + 1); }} />}
      {modal?.kind === "confirm" && (
        <Modal title={`Mark “${modal.c.name}” as ${modal.action === "complete" ? "completed" : "cancelled"}?`} sub="The dialer stops calling its leads" onClose={() => setModal(null)} width={460} footer={<><button type="button" className="btn g" onClick={() => setModal(null)}>Back</button><button type="button" className={modal.action === "cancel" ? "btn d" : "btn p"} onClick={() => act(modal.c, modal.action)}>{modal.action === "complete" ? "Complete" : "Cancel campaign"}</button></>}>
          <div className="mut">This can’t be undone from here.</div>
        </Modal>
      )}
    </>
  );
}

export default function More({ k, go, keys, ownOnly = false }) {
  const [modal, setModal] = useState(null);
  const meta = useCallingMeta();
  const canManage = meta.tier === "admin" || meta.tier === "manager";
  const tabs = Object.keys(TABS).filter((t) => !keys || keys.includes(t));
  const [title, sub] = TABS[k] || TABS.demos;
  return (
    <>
      <Head crumb={`Sales › ${title}`} title={title} lead={sub}>
        {k === "campaigns" && canManage && <button type="button" className="btn p" onClick={() => setModal({ kind: "edit", c: { ...C_BLANK } })}>+ New campaign</button>}
      </Head>
      {tabs.length > 1 && (
        <div className="tabs" role="tablist">
          {tabs.map((t) => <button key={t} type="button" role="tab" aria-selected={t === k} className={t === k ? "tab on" : "tab"} onClick={() => go(t)}>{TABS[t][0]}</button>)}
        </div>
      )}
      {k === "demos" && <Demos />}
      {k === "candidates" && <Candidates ownOnly={ownOnly} />}
      {k === "callsdash" && <CallsDash />}
      {k === "campaigns" && <Campaigns modal={modal} setModal={setModal} />}
    </>
  );
}
