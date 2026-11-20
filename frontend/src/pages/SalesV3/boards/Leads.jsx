import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { message } from "antd";
import { request } from "@/request";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import { FULL_ACCESS_ROLES } from "@/config/permissionModules";
import { DEPARTMENT_ROLES } from "@/config/roles";
import { STAGE_NAMES, subStatusesFor, stageColor } from "@/config/leadStages";
import { dialContact } from "@/pages/Calling/shared";
import { Head, Tabs, Pager, Empty, Fail, Skel, nf, initials, stageBadge, IST } from "../ui";
import { LeadLnk, AgentLnk, usePopups } from "../popups/Popups";
import { AddLead, EditLead, ChangeOwner, DeleteLeads, useSalesSetup, fullName, SOURCES } from "./leadForms";

const TeamActivity = lazy(() => import("./LeadsTeam"));
const ImportExport = lazy(() => import("./LeadsImport"));
const UsedLeads = lazy(() => import("./LeadsUsed"));

// v3 design — S3Leads / S3LeadStages / S3UsedLeads (+ Team Activity, Import / Export).
// Data: lead/stage-stats (+ ?part=quality), lead/by-stage (the list), lead CRUD,
// lead/assign-owner. Same scoping as before (backend leadController/scope.js).
const LEAD_ADMIN = [...FULL_ACCESS_ROLES, "Team Manager"];
const MANAGEMENT = [...FULL_ACCESS_ROLES, "Sales Manager", "Team Manager"];
const POOLS = [
  ["board", "On Board", "Leads still being worked — used leads no user has are in Used Leads."],
  ["used", "Used Leads", "Every lead that has been called (CRM leads), stage-wise."],
  ["all", "Total Received", "Every lead received so far, whether called or not."],
];
const QUALITY = [
  ["Interested Leads", "Interested", "#F97316"],
  ["Callback", "Callback", "#EC4899"],
  ["Demo Booking", "Demo booked", "#6366F1"],
  ["Enrolled", "Enrolled", "#16A34A"],
];
const BLANK = { q: "", createdFrom: "", createdTo: "", assignedUser: "", source: "", stage: "", subStatus: "", team: "", teamView: "" };
const HEAD_LEAD = {
  list: "Find, assign and work every lead.",
  stages: "Where every lead stands — click a stage to list its leads.",
  used: "Leads already called at least once — who called them last and what happened.",
  team: "Who is online, on a call or on break — and who is in the Lead Pool.",
  io: "Bring leads in, split them across teams, hand out unassigned leads, export.",
};
const cameIn = (d) => {
  if (!d) return "—";
  const k = new Date(d).toLocaleDateString("en-CA", IST);
  const today = new Date().toLocaleDateString("en-CA", IST);
  const yest = new Date(Date.now() - 864e5).toLocaleDateString("en-CA", IST);
  const t = new Date(d).toLocaleTimeString("en-IN", { ...IST, hour: "numeric", minute: "2-digit" });
  if (k === today) return `Today ${t}`;
  if (k === yest) return `Yesterday ${t}`;
  return new Date(d).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short" });
};

export default function Leads() {
  const me = useSelector(selectCurrentAdmin);
  const leadAdmin = LEAD_ADMIN.includes(me?.role);
  const manager = MANAGEMENT.includes(me?.role);
  const { admins, teamNames } = useSalesSetup();
  const salesUsers = admins.filter((a) => a.enabled !== false && DEPARTMENT_ROLES.Sales.includes(a.role));
  const { openLead } = usePopups();

  const [view, setView] = useState("list");
  const [pool, setPool] = useState("board");
  const [boardUser, setBoardUser] = useState("");
  const [stats, setStats] = useState(null);
  const [statsErr, setStatsErr] = useState(false);
  const [quality, setQuality] = useState(null);
  const [tick, setTick] = useState(0);
  // list
  const [draft, setDraft] = useState(BLANK);
  const [f, setF] = useState(BLANK);
  const [list, setList] = useState({ rows: [], count: 0, pages: 1, loading: true, error: false });
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(20);
  const [sel, setSel] = useState([]);
  const [modal, setModal] = useState(null); // {kind, ...}
  const [openStage, setOpenStage] = useState({});
  const [dialing, setDialing] = useState("");

  const listPool = pool;
  const usedRef = useRef(null);
  // Lead Stages: the picked stage / sub-status and its own list (design: the card under the charts)
  const [st, setSt] = useState({ stage: "", sub: "" });
  const [stList, setStList] = useState({ rows: [], count: 0, pages: 1, loading: true, error: false });
  const [stPage, setStPage] = useState(1);
  const [stPer, setStPer] = useState(10);

  // stage counts (+ quality)
  useEffect(() => {
    let live = true;
    const p = new URLSearchParams();
    if (boardUser) p.set("user", boardUser);
    if (!boardUser && listPool !== "board") p.set("pool", listPool);
    setStats(null);
    setStatsErr(false);
    setQuality(null);
    request.get({ entity: `lead/stage-stats${p.toString() ? `?${p}` : ""}` }).then((r) => {
      if (!live) return;
      if (r?.success) setStats(r.result);
      else setStatsErr(true);
    });
    const q = new URLSearchParams(p);
    q.set("part", "quality");
    request.get({ entity: `lead/stage-stats?${q}` }).then((r) => live && r?.success && setQuality(r.result.quality || null));
    return () => {
      live = false;
    };
  }, [listPool, boardUser, tick]);

  // the list
  useEffect(() => {
    let live = true;
    setList((l) => ({ ...l, loading: true, error: false }));
    const p = new URLSearchParams({ page: String(page), items: String(per) });
    Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
    if (listPool !== "board" && !boardUser) p.set("pool", listPool);
    if (f.stage && !f.teamView && !f.team && !f.assignedUser) {
      p.set("teamView", "responses");
      if (boardUser) p.set("user", boardUser);
    }
    request.get({ entity: `lead/by-stage?${p}` }).then((r) => {
      if (!live) return;
      if (r?.success) setList({ rows: r.result || [], count: r.pagination?.count || 0, pages: r.pagination?.pages || 1, loading: false, error: false });
      else setList({ rows: [], count: 0, pages: 1, loading: false, error: true });
    });
    return () => {
      live = false;
    };
  }, [f, page, per, listPool, boardUser, tick]);

  useEffect(() => {
    if (view !== "stages") return undefined;
    let live = true;
    setStList((l) => ({ ...l, loading: true, error: false }));
    const p = new URLSearchParams({ page: String(stPage), items: String(stPer) });
    if (st.stage) {
      p.set("stage", st.stage);
      if (st.sub) p.set("subStatus", st.sub);
      p.set("teamView", "responses");
      if (boardUser) p.set("user", boardUser);
    } else if (boardUser) p.set("assignedUser", boardUser);
    if (!boardUser && pool !== "board") p.set("pool", pool);
    request.get({ entity: `lead/by-stage?${p}` }).then((r) => {
      if (!live) return;
      if (r?.success) setStList({ rows: r.result || [], count: r.pagination?.count || 0, pages: r.pagination?.pages || 1, loading: false, error: false });
      else setStList({ rows: [], count: 0, pages: 1, loading: false, error: true });
    });
    return () => {
      live = false;
    };
  }, [view, st, stPage, stPer, pool, boardUser, tick]);
  useEffect(() => setStPage(1), [st, pool, boardUser]);

  useEffect(() => setSel([]), [f, listPool, boardUser]);
  const refresh = () => setTick((x) => x + 1);
  const apply = (next) => {
    setF(next);
    setDraft(next);
    setPage(1);
  };
  const pickStage = (stage, sub = "") => {
    apply({ ...f, stage: f.stage === stage && f.subStatus === sub ? "" : stage, subStatus: f.stage === stage && f.subStatus === sub ? "" : sub });
    setView("list");
  };
  const stages = stats?.stages || [];
  const total = stats?.total || 0;
  const countOf = (s) => (stages.find((x) => x.stage === s) || {}).count || 0;

  const viewFilter = () => {
    const out = {};
    if (f.stage) out.stage = f.stage;
    if (listPool !== "board" && !boardUser) out.pool = listPool;
    if (f.subStatus) out.subStatus = f.subStatus;
    ["q", "assignedUser", "team", "source", "teamView", "createdFrom", "createdTo"].forEach((k) => f[k] && (out[k] = f[k]));
    if (f.stage && !f.teamView && !f.team && !f.assignedUser) out.teamView = "responses";
    return out;
  };
  const pills = [
    f.q && ["q", `Search: ${f.q}`],
    f.stage && ["stage", `Stage: ${f.stage}`],
    f.subStatus && ["subStatus", `Sub-status: ${f.subStatus}`],
    f.assignedUser && ["assignedUser", `User: ${f.assignedUser === "none" ? "Unassigned" : fullName(salesUsers.find((a) => a._id === f.assignedUser)) || "User"}`],
    f.team && ["team", `Team: ${f.team}`],
    f.teamView && ["teamView", f.teamView === "mine" ? "My leads only" : "My team"],
    f.source && ["source", `Source: ${f.source}`],
    (f.createdFrom || f.createdTo) && ["created", `Came in: ${f.createdFrom || "…"} → ${f.createdTo || "…"}`],
  ].filter(Boolean);
  const dropPill = (k) => apply(k === "created" ? { ...f, createdFrom: "", createdTo: "" } : k === "stage" ? { ...f, stage: "", subStatus: "" } : { ...f, [k]: "" });
  const callRow = async (l) => {
    setDialing(l._id);
    const r = await dialContact({ phone: l.phone, contactName: l.name, callLead: l._id });
    setDialing("");
    if (r.ok) message.success(r.message || "Calling…");
    else message.error(r.message || "Could not start the call.");
  };
  const pageIds = list.rows.map((l) => l._id);
  const allTicked = pageIds.length > 0 && pageIds.every((id) => sel.includes(id));

  const TABS = [
    ["list", "Lead List"],
    ["stages", "Lead Stages"],
    ["used", "Used Leads"],
    ...(manager ? [["team", "Team Activity"]] : []),
    ...(leadAdmin ? [["io", "Import / Export"]] : []),
  ];

  return (
    <>
      <Head crumb={`Sales › Leads${view !== "list" ? ` › ${TABS.find((t) => t[0] === view)?.[1] || ""}` : ""}`} title="Leads" lead={HEAD_LEAD[view]}>
        {(view === "list" || view === "stages") && (
          <>
            {leadAdmin && <button type="button" className="btn" onClick={() => setView("io")}>Import / Export</button>}
            <button type="button" className="btn p" onClick={() => setModal({ kind: "add" })}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg> Add lead
            </button>
          </>
        )}
        {view === "used" && <button type="button" className="btn" onClick={() => usedRef.current?.exportCsv()}>Export CSV</button>}
        {view === "team" && <span className="src">calling/team-activity · /:id/pool · /:id/auto-start</span>}
        {view === "io" && <span className="b gy">Lead admins only</span>}
      </Head>

      {view === "list" && (
        <div className="sv3-stg" role="group" aria-label="Stages — click to filter">
          <button type="button" className={!f.stage ? "on" : ""} onClick={() => apply({ ...f, stage: "", subStatus: "" })}>
            <span>{pool === "board" ? "All leads" : POOLS.find((p) => p[0] === pool)?.[1]}</span>
            <b>{stats ? nf(total) : "—"}</b>
          </button>
          {STAGE_NAMES.map((s) => (
            <button key={s} type="button" className={f.stage === s ? "on" : ""} style={{ "--c": stageColor(s) }} onClick={() => pickStage(s)}>
              <span><i />{s}</span>
              <b>{stats ? nf(countOf(s)) : "—"}</b>
            </button>
          ))}
        </div>
      )}

      <Tabs items={TABS} value={view} onChange={setView} label="Leads views" />

      {view === "used" && (
        <Suspense fallback={<Skel h={300} />}><UsedLeads ref={usedRef} /></Suspense>
      )}

      {view === "list" && (
        <>
          <section className="fp" aria-label="Filters">
            <div className="row">
              <label className="srch">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5B6B79" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
                <input type="search" aria-label="Search leads by number, name or email" placeholder="Search number, name or email…" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && apply({ ...draft, q: e.currentTarget.value })} />
              </label>
            </div>
            <div className="fgrid">
              <label className="fld">Came in — from<input className="in" type="date" value={draft.createdFrom} max={draft.createdTo || undefined} onChange={(e) => setDraft({ ...draft, createdFrom: e.target.value })} /></label>
              <label className="fld">Came in — to<input className="in" type="date" value={draft.createdTo} min={draft.createdFrom || undefined} onChange={(e) => setDraft({ ...draft, createdTo: e.target.value })} /></label>
              {leadAdmin ? (
                <label className="fld">Sales user
                  <select className="sel" value={draft.assignedUser} onChange={(e) => setDraft({ ...draft, assignedUser: e.target.value })}>
                    <option value="">All users</option>
                    <option value="none">Unassigned</option>
                    {salesUsers.map((a) => <option key={a._id} value={a._id}>{fullName(a)}</option>)}
                  </select>
                </label>
              ) : (
                <label className="fld">Showing
                  <select className="sel" value={draft.teamView} onChange={(e) => setDraft({ ...draft, teamView: e.target.value })}>
                    <option value="">All leads</option>
                    <option value="1">My team</option>
                    <option value="mine">My leads only</option>
                  </select>
                </label>
              )}
              <label className="fld">Source
                <select className="sel" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })}>
                  <option value="">All sources</option>
                  {[...new Set([...SOURCES, "Facebook Ads", "Google Ads", "LinkedIn Ads", "Cold Call", "Import"])].map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="fld">Sub-status
                <select className="sel" value={draft.subStatus} disabled={!f.stage} title={f.stage ? undefined : "Pick a stage above first"} onChange={(e) => setDraft({ ...draft, stage: f.stage, subStatus: e.target.value })}>
                  <option value="">{f.stage ? "All sub-statuses" : "Pick a stage above first"}</option>
                  {(f.stage ? subStatusesFor(f.stage) : []).map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <div className="factions">
              <div className="applied">
                {pills.map(([k, l]) => <button key={k} type="button" className="pill" onClick={() => dropPill(k)}>{l} ✕</button>)}
                <span className="mut" style={{ fontSize: 12.5 }}>{list.loading ? "Loading…" : `${nf(list.count)} leads`}</span>
              </div>
              <div className="row">
                <button type="button" className="btn g" onClick={() => apply(BLANK)}>Reset</button>
                <button type="button" className="btn p" onClick={() => apply(draft)}>Apply</button>
              </div>
            </div>
          </section>

          {sel.length > 0 && (
            <div className="bulk">
              <b>{sel.length} selected</b>
              {manager && <button type="button" className="btn sm" onClick={() => setModal({ kind: "owner", ids: sel })}>Change owner</button>}
              {leadAdmin && <button type="button" className="btn sm d" onClick={() => setModal({ kind: "del", leads: list.rows.filter((l) => sel.includes(l._id)) })}>Delete</button>}
              <span className="sp" />
              <button type="button" className="btn sm g" style={{ color: "#fff" }} onClick={() => setSel([])}>Clear</button>
            </div>
          )}
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th scope="col"><input type="checkbox" aria-label="Select every lead on this page" checked={allTicked} disabled={!pageIds.length} onChange={() => setSel(allTicked ? sel.filter((id) => !pageIds.includes(id)) : [...new Set([...sel, ...pageIds])])} /></th>
                  <th scope="col">Lead</th>
                  <th scope="col">Number</th>
                  <th scope="col">Source</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Owner</th>
                  <th scope="col" className="num">Came in</th>
                  <th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.loading && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={8}><div className="skel" style={{ height: 22 }} /></td></tr>)}
                {!list.loading &&
                  list.rows.map((l) => {
                    return (
                      <tr key={l._id} className={sel.includes(l._id) ? "sel" : ""}>
                        <td><input type="checkbox" aria-label={`Select ${l.name}`} checked={sel.includes(l._id)} onChange={() => setSel((s) => (s.includes(l._id) ? s.filter((x) => x !== l._id) : [...s, l._id]))} /></td>
                        <td><span className="who"><span className="av">{initials(l.name)}</span><LeadLnk lead={l} phone={l.phone} ink>{l.name || "—"}</LeadLnk></span></td>
                        <td><LeadLnk lead={l} phone={l.phone} /></td>
                        <td>{l.source || "—"}</td>
                        <td><span className={stageBadge(l.stage)}>{l.stage || "—"}</span>{l.subStatus && <div className="mut" style={{ fontSize: 11.5, marginTop: 2 }}>{l.subStatus}</div>}</td>
                        <td>
                          {l.assignedUserName || l.assignedUser?.name ? <AgentLnk adminId={l.assignedUser?._id || (typeof l.assignedUser === "string" ? l.assignedUser : "")} name={l.assignedUserName || l.assignedUser?.name} /> : <span className="mut">—</span>}
                        </td>
                        <td className="num">{cameIn(l.facebookCreatedAt || l.created)}</td>
                        <td>
                          <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                            <button type="button" className="ib" aria-label="View details" title="View details" onClick={() => openLead({ lead: l, phone: l.phone })}>
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                            </button>
                            <button type="button" className="ib" aria-label="Edit lead" title="Edit lead" onClick={() => setModal({ kind: "edit", lead: l })}>
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                            </button>
                            {l.phone && (
                              <button type="button" className="ib" aria-label="Call" title="Call" disabled={dialing === l._id} onClick={() => callRow(l)}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4l2.8.7a2 2 0 0 1 1.7 2z" /></svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {!list.loading && list.error && <Fail onRetry={refresh} text="Couldn’t load the leads." />}
          {!list.loading && !list.error && list.rows.length === 0 && <Empty action={pills.length ? <button type="button" className="btn sm" onClick={() => apply(BLANK)}>Reset filters</button> : null} />}
          {list.count > 0 && <Pager page={page} pages={list.pages} count={list.count} per={per} pers={[10, 20, 50, 100, 200]} onPer={(n) => { setPer(n); setPage(1); }} onPage={setPage} noun="leads" />}
          <div className="also"><b style={{ color: "#0F1E2B" }}>Charts for leads live once, on the Dashboard:</b><a href="/sales-v3/dashboard">funnel · source bar →</a><span>Status donut → Lead Stages tab</span></div>
        </>
      )}

      {view === "stages" && (() => {
        const userName = fullName(salesUsers.find((a) => a._id === boardUser));
        const poolLabel = boardUser ? "Total leads" : POOLS.find((p) => p[0] === pool)?.[1];
        const allLabel = boardUser ? `All of ${userName}’s leads` : pool === "board" ? "All leads on board" : pool === "used" ? "All used leads" : "All leads received";
        const selRow = stages.find((x) => x.stage === st.stage);
        const selN = st.stage ? (st.sub ? (selRow?.subStatuses || []).find((x) => x.subStatus === st.sub)?.count || 0 : selRow?.count || 0) : total;
        const pick = (stage, sub = "") => setSt((o) => (o.stage === stage && o.sub === sub ? { stage: "", sub: "" } : { stage, sub }));
        return (
          <>
            <section className="fp">
              <div className="row">
                <div className="seg" role="group" aria-label="Which leads">
                  {POOLS.map(([k, l]) => (
                    <button key={k} type="button" className={pool === k && !boardUser ? "on" : ""} disabled={!!boardUser} title={boardUser ? "Pick Everyone to switch" : undefined} onClick={() => setPool(k)}>{l}{stats?.pools ? ` · ${nf(stats.pools[k] ?? 0)}` : ""}</button>
                  ))}
                </div>
                <span className="sp" />
                {leadAdmin && (
                  <label className="fld" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    Viewing
                    <select className="sel" style={{ width: "auto" }} value={boardUser} onChange={(e) => setBoardUser(e.target.value)}>
                      <option value="">Everyone</option>
                      {salesUsers.map((a) => <option key={a._id} value={a._id}>{fullName(a)}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <p className="mut" style={{ margin: 0, fontSize: 12.5 }}>{boardUser ? `Showing ${userName}’s leads only.` : POOLS.find((p) => p[0] === pool)?.[2]}</p>
            </section>
            <div className="g2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))" }}>
              <div className="card">
                <div className="ch"><div><h3>Lead status</h3><p>Donut · count and share · click a slice</p></div><span className="src">lead/stage-stats</span></div>
                {statsErr ? <Fail onRetry={refresh} /> : !stats ? <Skel h={250} /> : total === 0 ? <Empty /> : (
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <svg width="250" height="250" viewBox="0 0 42 42" role="img" aria-label="Leads by stage">
                      <circle cx="21" cy="21" r="15.915" fill="none" stroke="#EEF2F6" strokeWidth="6" />
                      {(() => {
                        let acc = 0;
                        return stages.filter((s) => s.count > 0).map((s) => {
                          const p = (s.count / total) * 100;
                          const el = (
                            <circle key={s.stage} cx="21" cy="21" r="15.915" fill="none" stroke={s.color || stageColor(s.stage)} strokeWidth={st.stage === s.stage ? 8 : 6} strokeDasharray={`${p} ${100 - p}`} strokeDashoffset={25 - acc} style={{ cursor: "pointer" }} onClick={() => pick(s.stage)}>
                              <title>{`${s.stage}: ${nf(s.count)} (${Math.round(p)}%)`}</title>
                            </circle>
                          );
                          acc += p;
                          return el;
                        });
                      })()}
                      <text x="21" y="20.5" textAnchor="middle" fontSize="5.5" fontWeight="700" fill="#0F1E2B" fontFamily="Space Grotesk">{nf(st.stage ? selRow?.count || 0 : total)}</text>
                      <text x="21" y="25.5" textAnchor="middle" fontSize="2.6" fill="#5B6B79" fontFamily="Inter">{st.stage || poolLabel}</text>
                    </svg>
                  </div>
                )}
                <div className="card" style={{ marginTop: 14, background: "#F8FAFC" }}>
                  <div className="ch" style={{ marginBottom: 8 }}><div><h3>Lead quality</h3><p>Of the leads someone actually spoke to</p></div><span className="src">stage-stats?part=quality</span></div>
                  {!quality ? <Skel h={90} /> : !quality.contacted ? <Empty /> : QUALITY.map(([s, label, c]) => {
                    const n = quality.byStage?.[s] || 0;
                    const p = quality.contacted ? Math.round((n / quality.contacted) * 100) : 0;
                    return (
                      <div key={s} className="hb" style={{ gridTemplateColumns: "110px 1fr 90px" }} title={`${label}: ${nf(n)} of ${nf(quality.contacted)} spoken to`}>
                        <span>{label}</span>
                        <span className="t"><b style={{ width: `${Math.min(100, p * 3)}%`, background: c }} /></span>
                        <span className="n">{nf(n)} <span className="mut" style={{ fontWeight: 500 }}>{p}%</span></span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="card">
                <div className="ch"><div><h3>All stages</h3><p>Click a row to list it · ▸ to see sub-statuses</p></div><button type="button" className="btn sm" onClick={() => setSt({ stage: "", sub: "" })}>{allLabel}</button></div>
                {statsErr ? <Fail onRetry={refresh} /> : !stats ? <Skel h={300} /> : (() => {
                  const max = Math.max(1, ...stages.map((s) => s.count));
                  return stages.map((s) => {
                    const subs = s.subStatuses || [];
                    const op = !!openStage[s.stage];
                    return (
                      <div key={s.stage}>
                        <div className={st.stage === s.stage && !st.sub ? "sv3-srow on" : "sv3-srow"} role="button" tabIndex={0} onClick={() => pick(s.stage)} onKeyDown={(e) => e.key === "Enter" && pick(s.stage)}>
                          {subs.length ? (
                            <button type="button" className="xb" aria-label="Show sub-statuses" aria-expanded={op} onClick={(e) => { e.stopPropagation(); setOpenStage((o) => ({ ...o, [s.stage]: !op })); }}>{op ? "▾" : "▸"}</button>
                          ) : <span />}
                          <span style={{ fontWeight: 600, display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}><i className="dot" style={{ background: s.color || stageColor(s.stage) }} />{s.stage}</span>
                          <span className="t"><b style={{ width: `${s.count ? Math.max((s.count / max) * 100, 2) : 0}%`, background: s.color || stageColor(s.stage) }} /></span>
                          <span className="num" style={{ textAlign: "right", fontWeight: 700 }}>{nf(s.count)}</span>
                          <span className="mut" style={{ textAlign: "right" }}>{total ? Math.round((s.count / total) * 100) : 0}%</span>
                        </div>
                        {op && subs.map((ss) => (
                          <div key={ss.subStatus} className={st.stage === s.stage && st.sub === ss.subStatus ? "sv3-sub on" : "sv3-sub"} role="button" tabIndex={0} onClick={() => pick(s.stage, ss.subStatus)} onKeyDown={(e) => e.key === "Enter" && pick(s.stage, ss.subStatus)}>
                            <span /><span>↳ {ss.subStatus}</span><span /><span style={{ textAlign: "right" }}>{nf(ss.count)}</span><span />
                          </div>
                        ))}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            <div className="card">
              <div className="ch">
                <div><h3>{st.stage ? `${st.stage}${st.sub ? ` › ${st.sub}` : ""} · ${nf(selN)} leads` : `${allLabel} · ${nf(total)}`}</h3><p>Same list the Lead List tab shows for this stage</p></div>
                <button type="button" className="btn sm" onClick={() => { apply({ ...BLANK, stage: st.stage, subStatus: st.sub, assignedUser: !st.stage && boardUser ? boardUser : "" }); setView("list"); }}>Open in Lead List →</button>
              </div>
              <div className="tw">
                <table>
                  <thead><tr><th scope="col">Lead</th><th scope="col">Phone</th><th scope="col">Stage · sub-status</th><th scope="col">Owner</th><th scope="col">Came in</th></tr></thead>
                  <tbody>
                    {stList.loading && [0, 1, 2, 3].map((i) => <tr key={i}><td colSpan={5}><div className="skel" style={{ height: 22 }} /></td></tr>)}
                    {!stList.loading && stList.rows.map((l) => (
                      <tr key={l._id}>
                        <td><LeadLnk lead={l} phone={l.phone} ink>{l.name || "—"}</LeadLnk></td>
                        <td><LeadLnk lead={l} phone={l.phone} /></td>
                        <td><span className={stageBadge(l.stage)}>{l.stage || "—"}</span> <span className="mut">{l.subStatus || ""}</span></td>
                        <td>{l.assignedUserName || l.assignedUser?.name ? <AgentLnk adminId={l.assignedUser?._id || (typeof l.assignedUser === "string" ? l.assignedUser : "")} name={l.assignedUserName || l.assignedUser?.name} /> : "—"}</td>
                        <td>{cameIn(l.facebookCreatedAt || l.created)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!stList.loading && stList.error && <Fail onRetry={refresh} text="Couldn’t load the leads." />}
              {!stList.loading && !stList.error && stList.rows.length === 0 && <Empty />}
              {stList.count > 0 && <Pager page={stPage} pages={stList.pages} count={stList.count} per={stPer} pers={[10, 20, 50]} onPer={(n) => { setStPer(n); setStPage(1); }} onPage={setStPage} noun="leads" />}
            </div>
          </>
        );
      })()}

      {view === "team" && manager && (
        <Suspense fallback={<Skel h={300} />}><TeamActivity /></Suspense>
      )}
      {view === "io" && leadAdmin && (
        <Suspense fallback={<Skel h={300} />}><ImportExport teamNames={teamNames} admins={admins} onChanged={refresh} /></Suspense>
      )}

      {modal?.kind === "add" && <AddLead teamNames={teamNames} salesUsers={salesUsers} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.kind === "edit" && <EditLead lead={modal.lead} teamNames={teamNames} salesUsers={salesUsers} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.kind === "owner" && <ChangeOwner leadIds={modal.ids || []} single={modal.single} viewFilter={viewFilter()} total={list.count} salesUsers={salesUsers} onClose={() => setModal(null)} onDone={() => { setSel([]); refresh(); }} />}
      {modal?.kind === "del" && <DeleteLeads leads={modal.leads} onClose={() => setModal(null)} onDone={() => { setSel([]); refresh(); }} />}
    </>
  );
}
