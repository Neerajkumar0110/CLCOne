import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useSelector } from "react-redux";
import { request } from "@/request";
import { selectCurrentAdmin } from "@/redux/auth/selectors";
import HubModal from "@/components/HubModal";
import { AgentLnk } from "../popups/Popups";
import ConversionFunnel from "../components/ConversionFunnel";
import SystemSettings from "@/pages/SalesDashboard/SystemSettings";
import useBusinessLock from "@/hooks/useBusinessLock";
import { downloadFile } from "@/pages/WorkTracker/Sales360";

// v3 design — S3Dashboard, with real data only:
//   workday/admin/360               → totals, trend (calls), rows, people / teams / roles
//   workday/admin/360/leads-report  → leads per day (trend), leads by source
//   lead/stage-stats                → total leads + leads per stage (same as Leads › Lead Stages)
const PRESETS = [
  ["today", "Today", () => [dayjs().startOf("day"), dayjs()]],
  ["7d", "7 days", () => [dayjs().subtract(6, "day").startOf("day"), dayjs()]],
  ["30d", "30 days", () => [dayjs().subtract(29, "day").startOf("day"), dayjs()]],
  ["month", "This month", () => [dayjs().startOf("month"), dayjs()]],
  ["year", "1 year", () => [dayjs().subtract(1, "year").add(1, "day").startOf("day"), dayjs()]],
];
const MANAGEMENT = ["owner", "Super Admin", "Admin", "Sales Manager", "Team Manager"];
const nf = (n) => Number(n || 0).toLocaleString("en-IN");
const inr = (n) => `₹${nf(Math.round(n || 0))}`;
const ICON = {
  leads: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  plus: "M12 5v14M5 12h14",
  star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
  check: "M20 6L9 17l-5-5",
  pct: "M19 5L5 19M6.5 6.5h.01M17.5 17.5h.01",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4l2.8.7a2 2 0 0 1 1.7 2z",
  money: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
};
const delta = (now, prev) => {
  if (!prev) return null;
  const p = Math.round(((now - prev) / prev) * 100);
  return { text: `${p >= 0 ? "↑" : "↓"} ${Math.abs(p)}% vs previous`, cls: p >= 0 ? "d up" : "d dn" };
};
const stageCount = (ss, name) => ((ss?.stages || []).find((s) => s.stage === name) || {}).count || 0;
const dayLabel = (k) => {
  const d = dayjs(k);
  return d.isValid() ? d.format("D MMM") : String(k);
};

export default function Dashboard({ ownOnly, go }) {
  const me = useSelector(selectCurrentAdmin);
  const manager = MANAGEMENT.includes(me?.role);
  const businessLock = useBusinessLock();
  // draft filters (the panel) and applied filters (what the page shows) — Apply copies one to the other
  const blank = { preset: "today", team: "", user: "", source: "", role: "" };
  const [draft, setDraft] = useState(blank);
  const [applied, setApplied] = useState(blank);
  const [search, setSearch] = useState("");
  const [data, setData] = useState(null);
  const [leads, setLeads] = useState(null);
  const [stages, setStages] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | data | error
  const [tick, setTick] = useState(0);
  const [rankBy, setRankBy] = useState("calls");
  const [sort, setSort] = useState({ k: "calls", d: -1 });
  const [per, setPer] = useState(10);
  const [page, setPage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [exporting, setExporting] = useState(false);

  const params = useMemo(() => {
    const [from, to] = (PRESETS.find((p) => p[0] === applied.preset) || PRESETS[0])[2]();
    const p = { from: from.toISOString(), to: to.toISOString() };
    const adminId = manager ? applied.user : String(me?._id || "");
    if (adminId) p.adminId = adminId;
    if (applied.team && !adminId) p.team = applied.team;
    if (applied.role && !adminId) p.role = applied.role;
    if (applied.source) p.source = applied.source;
    return p;
  }, [applied, manager, me?._id]);

  useEffect(() => {
    let live = true;
    setStatus("loading");
    const qs = new URLSearchParams(params).toString();
    Promise.all([
      request.get({ entity: `workday/admin/360?${qs}` }),
      request.get({ entity: `workday/admin/360/leads-report?${qs}` }),
      request.get({ entity: "lead/stage-stats" }),
    ]).then(([r, l, s]) => {
      if (!live) return;
      if (!r?.success) {
        setStatus("error");
        return;
      }
      setData(r.result);
      setLeads(l?.success ? l.result : null);
      setStages(s?.success ? s.result : null);
      setStatus("data");
      setPage(1);
    });
    return () => {
      live = false;
    };
  }, [params, tick]);

  const t = data?.totals || {};
  const sales = t.sales || {};
  const rows = data?.rows || [];
  const totalLeads = stages?.total || 0;
  const enrolled = stageCount(stages, "Enrolled");
  const isLoading = status === "loading";
  const isError = status === "error";
  const isEmpty = status === "data" && !rows.length && !(t.calls > 0);
  const isData = status === "data" && !isEmpty;

  const kpis = [
    ["Total leads", nf(totalLeads), { text: "every lead on the board", cls: "d mut" }, "leads"],
    ["New leads", nf(stageCount(stages, "New Lead")), { text: "not called yet", cls: "d mut" }, "plus"],
    ["Interested", nf(stageCount(stages, "Interested Leads")), { text: "in Interested Leads now", cls: "d mut" }, "star"],
    ["Prospects (qualified)", nf(sales.prospects), { text: "moved to Prospects in range", cls: "d mut" }, "check"],
    ["Enrolled (converted)", nf(enrolled), { text: "in Enrolled now", cls: "d mut" }, "check"],
    ["Conversion rate", totalLeads ? `${((enrolled / totalLeads) * 100).toFixed(1)}%` : "—", { text: "enrolled ÷ leads", cls: "d mut" }, "pct"],
    ["Total calls", nf(t.calls), delta(t.calls || 0, t.prev?.calls) || { text: "in range", cls: "d mut" }, "phone"],
    ["Connected calls", nf(t.connected), { text: `${t.calls ? Math.round(((t.connected || 0) / t.calls) * 100) : 0}% connect rate`, cls: "d mut" }, "phone"],
    ["Revenue collected", inr(t.pay?.collected), { text: "payments received", cls: "d mut" }, "money"],
    ["Active sales users", nf(t.activeUsers), { text: "made a call in range", cls: "d mut" }, "users"],
  ];

  // Leads & calls over time (line): leads per bucket (left scale), calls ÷ 10 (dashed)
  const callTrend = data?.trend || [];
  const leadByKey = new Map((leads?.trend || []).map((x) => [x.key, x.n]));
  const points = callTrend.map((c) => ({ key: c.key, leads: leadByKey.get(c.key) || 0, calls: c.calls || 0 }));
  const yMax = Math.max(1, ...points.map((p) => Math.max(p.leads, p.calls / 10)));
  const X = (i) => (points.length > 1 ? 44 + (i * 666) / (points.length - 1) : 377);
  const Y = (v) => 215 - (v / yMax) * 195;
  const leadsPts = points.map((p, i) => `${X(i)},${Y(p.leads)}`).join(" ");
  const callsPts = points.map((p, i) => `${X(i)},${Y(p.calls / 10)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));

  // Conversion funnel — leads moved into each step in the range (totals.sales)
  const FN = [
    ["Connected", sales.connected, "#0B5F58"],
    ["Interested", sales.interested, "#0F766E"],
    ["Demo booked", sales.demoBooked, "#2F9E8F"],
    ["Prospects", sales.prospects, "#2563EB"],
    ["Enrolled", sales.enrolled, "#1E293B"],
  ]
    .map(([n, v, c]) => [n, v || 0, c])
    // biggest step on top, then smaller and smaller — a real funnel shape
    .sort((a, b) => b[1] - a[1]);
  const fTop = Math.max(1, FN[0][1]);

  // Leads by source (bar)
  const src = (leads?.bySource || []).slice(0, 6);
  const srcMax = Math.max(1, ...src.map((s) => s.n));

  // Ranking (horizontal bar)
  const RANK = { calls: ["Calls", (r) => r.calls || 0], connected: ["Connected", (r) => r.connected || 0], enrolled: ["Enrolled", (r) => r.sales?.enrolled || 0] };
  const ranking = [...rows].sort((a, b) => RANK[rankBy][1](b) - RANK[rankBy][1](a)).slice(0, 8);
  const rankMax = Math.max(1, ...ranking.map((r) => RANK[rankBy][1](r)));

  // Every sales user (sortable, paged)
  const COLS = [
    ["name", "Sales user", (r) => r.name || ""],
    ["team", "Team", (r) => r.team || ""],
    ["calls", "Calls", (r) => r.calls || 0],
    ["connected", "Connected", (r) => r.connected || 0],
    ["leads", "Leads", (r) => r.leadsResponded || 0],
    ["prospects", "Prospects", (r) => r.sales?.prospects || 0],
    ["enrolled", "Enrolled", (r) => r.sales?.enrolled || 0],
    ["rev", "Revenue", (r) => r.pay?.collected || 0],
  ];
  const q = search.trim().toLowerCase();
  const sortFn = (COLS.find((c) => c[0] === sort.k) || COLS[2])[2];
  const tableRows = rows
    .filter((r) => !q || `${r.name} ${r.email || ""} ${r.team || ""}`.toLowerCase().includes(q))
    .sort((a, b) => {
      const x = sortFn(a);
      const y = sortFn(b);
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sort.d;
    });
  const pages = Math.max(1, Math.ceil(tableRows.length / per));
  const pg = Math.min(page, pages);
  const shown = tableRows.slice((pg - 1) * per, pg * per);

  const appliedPills = [
    applied.team && ["team", `Team: ${applied.team}`],
    applied.user && ["user", `User: ${(data?.people || []).find((p) => p.adminId === applied.user)?.name || "User"}`],
    applied.source && ["source", `Source: ${applied.source}`],
    applied.role && ["role", `Role: ${applied.role}`],
  ].filter(Boolean);
  const removePill = (k) => {
    const next = { ...applied, [k]: "" };
    setApplied(next);
    setDraft(next);
  };
  const rangeText = (() => {
    const [from, to] = (PRESETS.find((p) => p[0] === applied.preset) || PRESETS[0])[2]();
    return `${from.format("D MMM")} – ${to.format("D MMM YYYY")}`;
  })();

  const exportExcel = async () => {
    setExporting(true);
    await downloadFile(`workday/admin/360/export?${new URLSearchParams(params)}`, "sales-360.xlsx");
    setExporting(false);
  };

  const State = ({ title, text }) => (
    <div className="state">
      <b>{title}</b>
      {text}
    </div>
  );
  const notData = isLoading ? (
    <div className="skel" style={{ height: 180 }} />
  ) : isError ? (
    <div className="state err">
      <b>Couldn’t load this chart.</b>The rest of the dashboard still works.{" "}
      <button type="button" className="btn sm" onClick={() => setTick((x) => x + 1)}>Retry</button>
    </div>
  ) : (
    <State title="No data available for the selected filters." text="Try a wider date range or clear a filter." />
  );

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">Sales › {ownOnly ? "My Day" : "Dashboard"}</div>
          <h1>{ownOnly ? "My Day" : "Sales Dashboard"}</h1>
          <p className="lead">Leads, calls, conversions and revenue for the filters you pick.</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={exportExcel} disabled={exporting}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            {exporting ? "Exporting…" : "Export Excel"}
          </button>
          {!businessLock && manager && (
            <button type="button" className="btn" onClick={() => setShowSettings(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
              Systems &amp; Costs
            </button>
          )}
        </div>
      </div>

      <section className="fp" aria-label="Filters">
        <div className="row">
          <label className="srch">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5B6B79" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
            <input type="search" aria-label="Search sales users" placeholder="Search a sales user by name, email or team…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </label>
          <div className="seg" role="group" aria-label="Date range">
            {PRESETS.map(([k, l]) => (
              <button key={k} type="button" className={draft.preset === k ? "on" : ""} onClick={() => setDraft({ ...draft, preset: k })}>{l}</button>
            ))}
          </div>
        </div>
        {manager && (
          <div className="fgrid">
            <label className="fld">Team
              <select className="sel" value={draft.team} onChange={(e) => setDraft({ ...draft, team: e.target.value })}>
                <option value="">All teams</option>
                {(data?.teams || []).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label className="fld">Sales user
              <select className="sel" value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })}>
                <option value="">All users</option>
                {(data?.people || []).map((p) => <option key={p.adminId} value={p.adminId}>{p.name}</option>)}
              </select>
            </label>
            <label className="fld">Source
              <select className="sel" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })}>
                <option value="">All sources</option>
                {(leads?.bySource || []).map((s) => s.key).filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="fld">Role
              <select className="sel" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
                <option value="">All roles</option>
                {(data?.roles || []).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="factions">
          <div className="applied">
            {appliedPills.map(([k, l]) => (
              <button key={k} type="button" className="pill" onClick={() => removePill(k)}>{l} ✕</button>
            ))}
            <span className="mut" style={{ fontSize: 12.5 }}>{rangeText}</span>
          </div>
          <div className="row">
            <button type="button" className="btn g" onClick={() => { setDraft(blank); setApplied(blank); setSearch(""); }}>Reset</button>
            <button type="button" className="btn p" onClick={() => setApplied(draft)}>Apply</button>
          </div>
        </div>
      </section>

      <div className="kpis">
        {kpis.map(([l, v, d, ic]) => (
          <div key={l} className="kpi">
            <div className="l">
              <i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[ic]} /></svg></i>
              {l}
            </div>
            {isLoading ? (
              <div className="skel" style={{ height: 28, width: "70%" }} />
            ) : (
              <>
                <div className="v">{isError ? "—" : v}</div>
                <div className={d.cls}>{d.text}</div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="ch">
          <div><h3>Leads &amp; calls over time</h3><p>Line chart · trend for the selected range</p></div>
          <span className="src">workday/admin/360 → trend[]</span>
        </div>
        {isData && points.length ? (
          <>
            <svg viewBox="0 0 720 240" width="100%" height="240" role="img" aria-label="Leads and calls per day">
              <line x1="44" y1="20" x2="710" y2="20" stroke="#EEF2F6" />
              <line x1="44" y1="85" x2="710" y2="85" stroke="#EEF2F6" />
              <line x1="44" y1="150" x2="710" y2="150" stroke="#EEF2F6" />
              <line x1="44" y1="215" x2="710" y2="215" stroke="#CFD8E1" />
              <text x="36" y="24" textAnchor="end" fontSize="11" fill="#5B6B79">{nf(Math.ceil(yMax))}</text>
              <text x="36" y="219" textAnchor="end" fontSize="11" fill="#5B6B79">0</text>
              <polyline points={callsPts} fill="none" stroke="#94A3B8" strokeWidth="2.5" strokeDasharray="6 5" />
              <polyline points={leadsPts} fill="none" stroke="#0F766E" strokeWidth="3" />
              {points.map((p, i) => (
                <g key={p.key}>
                  <circle cx={X(i)} cy={Y(p.leads)} r={points.length > 31 ? 3 : 5} fill="#0F766E">
                    <title>{`${dayLabel(p.key)}: ${nf(p.leads)} leads · ${nf(p.calls)} calls`}</title>
                  </circle>
                  {i % labelEvery === 0 && <text x={X(i)} y="234" textAnchor="middle" fontSize="11" fill="#5B6B79">{dayLabel(p.key)}</text>}
                </g>
              ))}
            </svg>
            <div className="legend">
              <span><i className="dot" style={{ background: "#0F766E" }} /> New leads (left scale)</span>
              <span><i className="dot" style={{ background: "#94A3B8" }} /> Calls ÷ 10</span>
              <span className="mut">Hover a point for the exact number</span>
            </div>
          </>
        ) : isLoading ? (
          <div className="skel" style={{ height: 220 }} />
        ) : (
          notData
        )}
      </div>

      <div className="g2">
        <div style={{ minWidth: 0 }}>
          {isData ? (
            <ConversionFunnel
              compact
              data={{ connected: sales.connected, interested: sales.interested, demoBooked: sales.demoBooked, prospects: sales.prospects, enrolled: sales.enrolled }}
              dateRange={(PRESETS.find((p) => p[0] === applied.preset) || PRESETS[0])[1]}
              onDateClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            />
          ) : (
            <div className="card">{notData}</div>
          )}
        </div>
        <div className="card">
          <div className="ch">
            <div><h3>Lead status</h3><p>Not repeated here — the status donut, sub-statuses and lead quality live once, in Leads › Lead Stages.</p></div>
          </div>
          <button type="button" className="btn p" onClick={() => go("leads")}>Open Lead Stages →</button>
        </div>
      </div>

      <div className="g2">
        <div className="card">
          <div className="ch">
            <div><h3>Leads by source</h3><p>Bar chart · which channel brings leads</p></div>
            <span className="src">workday/admin/360/leads-report → bySource</span>
          </div>
          {isData && src.length ? (
            <>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 16, height: 200, padding: "0 6px", borderBottom: "1px solid #CFD8E1" }}>
                {src.map((s) => (
                  <div key={s.key || "none"} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 6 }} title={`${s.key || "No source"}: ${nf(s.n)}`}>
                    <b style={{ fontSize: 12.5 }}>{nf(s.n)}</b>
                    <i style={{ display: "block", width: "100%", maxWidth: 56, height: `${Math.max(2, (s.n / srcMax) * 160)}px`, background: "#0F766E", borderRadius: "6px 6px 0 0" }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 16, padding: "6px 6px 0" }}>
                {src.map((s) => <span key={s.key || "none"} style={{ flex: 1, textAlign: "center", fontSize: 12, color: "#3E4C59" }}>{s.key || "No source"}</span>)}
              </div>
            </>
          ) : (
            notData
          )}
        </div>
        <div className="card">
          <div className="ch">
            <div><h3>Sales user ranking</h3><p>Horizontal bar · click a name for their full day</p></div>
            <div className="seg" role="group" aria-label="Rank by">
              {Object.entries(RANK).map(([k, [l]]) => (
                <button key={k} type="button" className={rankBy === k ? "on" : ""} onClick={() => setRankBy(k)}>{l}</button>
              ))}
            </div>
          </div>
          {isData && ranking.length ? (
            <>
              {ranking.map((r) => (
                <div key={r.adminId} className="hb" title={`${r.name}: ${nf(RANK[rankBy][1](r))}`}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><AgentLnk adminId={r.adminId} name={r.name} /></span>
                  <span className="t"><b style={{ width: `${(RANK[rankBy][1](r) / rankMax) * 100}%`, background: "#0F766E" }} /></span>
                  <span className="n">{nf(RANK[rankBy][1](r))}</span>
                </div>
              ))}
              <div className="also" style={{ border: 0, paddingTop: 6 }}><span className="src">workday/admin/360 → rows[]</span></div>
            </>
          ) : (
            notData
          )}
        </div>
      </div>

      <div className="card">
        <div className="ch">
          <div><h3>Every sales user</h3><p>Same numbers as the cards and charts above · click a header to sort</p></div>
          <span className="src">workday/admin/360 → rows[]</span>
        </div>
        {isLoading ? (
          <div className="skel" style={{ height: 200 }} />
        ) : !tableRows.length ? (
          notData
        ) : (
          <>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    {COLS.map(([k, l]) => (
                      <th
                        key={k}
                        scope="col"
                        className={`s${["name", "team"].includes(k) ? "" : " num"}`}
                        aria-sort={sort.k === k ? (sort.d < 0 ? "descending" : "ascending") : "none"}
                        onClick={() => { setSort({ k, d: sort.k === k ? -sort.d : -1 }); setPage(1); }}
                      >
                        {l} {sort.k === k ? (sort.d < 0 ? "↓" : "↑") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.adminId}>
                      <td>
                        <span className="who">
                          <span className="av">{String(r.name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
                          <AgentLnk adminId={r.adminId} name={r.name} />
                        </span>
                      </td>
                      <td>{r.team ? <span className="b gy">{r.team}</span> : "—"}</td>
                      <td className="num">{nf(r.calls)}</td>
                      <td className="num">{nf(r.connected)}</td>
                      <td className="num">{nf(r.leadsResponded)}</td>
                      <td className="num">{nf(r.sales?.prospects)}</td>
                      <td className="num">{nf(r.sales?.enrolled)}</td>
                      <td className="num">{inr(r.pay?.collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span>{`${(pg - 1) * per + 1}–${Math.min(pg * per, tableRows.length)} of ${tableRows.length}`}</span>
              <div className="pp">
                <label className="row" style={{ gap: 6 }}>
                  Rows
                  <select className="sel" style={{ width: "auto", minHeight: 36 }} value={per} onChange={(e) => { setPer(Number(e.target.value)); setPage(1); }} aria-label="Rows per page">
                    {[5, 10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button type="button" className="pb" onClick={() => setPage(pg - 1)} disabled={pg <= 1} aria-label="Previous page">‹</button>
                {Array.from({ length: pages }, (_, i) => i + 1)
                  .filter((n) => Math.abs(n - pg) <= 2 || n === 1 || n === pages)
                  .map((n) => (
                    <button key={n} type="button" className={n === pg ? "pb on" : "pb"} onClick={() => setPage(n)}>{n}</button>
                  ))}
                <button type="button" className="pb" onClick={() => setPage(pg + 1)} disabled={pg >= pages} aria-label="Next page">›</button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="also">
        <b style={{ color: "#0F1E2B" }}>Not repeated here:</b>
        <a href="/sales-v3/reports" onClick={(e) => { e.preventDefault(); go("reports"); }}>Call outcomes, heatmap, talk length → Call Reports</a>
        <a href="/sales-v3/team" onClick={(e) => { e.preventDefault(); go("team"); }}>Attendance → Team &amp; Attendance</a>
        <a href="/sales-v3/payments" onClick={(e) => { e.preventDefault(); go("payments"); }}>Revenue → Payments</a>
        <a href="/sales-v3/history" onClick={(e) => { e.preventDefault(); go("history"); }}>Every call → Call History</a>
      </div>

      {showSettings && (
          <HubModal
            open
            onClose={() => setShowSettings(false)}
            title="Systems & Costs"
            subtitle="Classify teams into B2B / B2C systems and record monthly costs"
            width={720}
            footer={<button type="button" className="hub-btn hub-btn-primary" onClick={() => setShowSettings(false)}>Done</button>}
          >
            <SystemSettings />
          </HubModal>
      )}
    </>
  );
}
