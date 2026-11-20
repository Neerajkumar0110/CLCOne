import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { message } from "antd";
import { useCallingMeta } from "@/pages/Calling/shared";
import { request } from "@/request";
import { Head, Empty, Fail, Skel, nf, talk, initials } from "../ui";
import { AgentLnk } from "../popups/Popups";

// v3 design — S3CallReports. Every call number and chart, once, for one range.
//   workday/admin/360?from&to&adminId&campaign&team → totals (KPIs), trend (area),
//        outcomes (pie), dispositions, heat (weekday × hour), rows (agent table, missed)
//   workday/admin/360/dialer-report?from&to          → dialer use (capacity, calls/hour)
//   calling/reports?range&campaign&agent             → campaign table (its own day window)
const PRESETS = [
  ["yday", "Yesterday", () => [dayjs().subtract(1, "day").startOf("day"), dayjs().subtract(1, "day").endOf("day")]],
  ["7d", "Last 7 days", () => [dayjs().subtract(6, "day").startOf("day"), dayjs()]],
  ["month", "This month", () => [dayjs().startOf("month"), dayjs()]],
  ["custom", "Custom", null],
];
const OUT = {
  connected: ["Talked", "#0F766E"],
  "no-answer": ["No answer", "#94A3B8"],
  busy: ["Busy", "#2563EB"],
  failed: ["Switched off / failed", "#1E293B"],
  missed: ["Missed by agent", "#EA580C"],
};
const OUT_MORE = ["#5EC4B6", "#7C3AED", "#CBD5E1", "#0EA5E9", "#B45309"];
const DISP_C = ["#94A3B8", "#EA580C", "#1E293B", "#2563EB", "#0F766E", "#5EC4B6", "#7C3AED", "#0EA5E9", "#CBD5E1", "#B45309", "#16A34A", "#B42318"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const COLS = [["name", "Agent"], ["calls", "Dialled"], ["connected", "Talked"], ["connectRate", "Connect rate"], ["talkSec", "Talk time"], ["missed", "Missed"], ["callsPerHour", "Calls / hr"]];
const reportsRange = (days) => (days <= 7 ? ["1W", "last 7 days"] : days <= 30 ? ["1M", "last 30 days"] : days <= 90 ? ["3M", "last 3 months"] : days <= 182 ? ["6M", "last 6 months"] : ["1Y", "last year"]);

export default function CallReports() {
  const meta = useCallingMeta();
  const [preset, setPreset] = useState("7d");
  const [cr, setCr] = useState({ from: "", to: "" });
  const [agent, setAgent] = useState("");
  const [campaign, setCampaign] = useState("");
  const [team, setTeam] = useState("");
  const [d, setD] = useState({ s: null, dial: null, rep: null, loading: true, error: false });
  const [opts, setOpts] = useState({ people: [], teams: [], campaigns: [] });
  const [sort, setSort] = useState(["connectRate", -1]);
  const [tick, setTick] = useState(0);

  const [from, to] = useMemo(() => {
    if (preset === "custom") return cr.from && cr.to ? [dayjs(cr.from).startOf("day"), dayjs(cr.to).endOf("day")] : [null, null];
    return PRESETS.find((p) => p[0] === preset)[2]();
  }, [preset, cr]);
  const days = from && to ? Math.max(1, Math.ceil(to.diff(from, "hour") / 24)) : 7;
  const [repRange, repLabel] = reportsRange(days);

  useEffect(() => {
    if (!from || !to) return undefined;
    let live = true;
    setD((x) => ({ ...x, loading: true, error: false }));
    const q = new URLSearchParams({ from: from.toISOString(), to: (to.isAfter(dayjs()) ? dayjs() : to).toISOString() });
    if (agent) q.set("adminId", agent);
    if (campaign) q.set("campaign", campaign);
    if (team) q.set("team", team);
    const rq = new URLSearchParams({ range: repRange });
    if (campaign) rq.set("campaign", campaign);
    if (agent) rq.set("agent", agent);
    Promise.all([
      request.get({ entity: `workday/admin/360?${q}` }),
      request.get({ entity: `workday/admin/360/dialer-report?${new URLSearchParams({ from: q.get("from"), to: q.get("to") })}` }),
      request.get({ entity: `calling/reports?${rq}` }),
    ]).then(([a, b, c]) => {
      if (!live) return;
      if (!a?.success) return setD({ s: null, dial: null, rep: null, loading: false, error: true });
      setD({ s: a.result, dial: b?.success ? b.result : null, rep: c?.success ? c.result : null, loading: false, error: false });
      setOpts((o) => ({
        people: a.result.people?.length ? a.result.people : o.people,
        teams: a.result.teams?.length ? a.result.teams : o.teams,
        campaigns: a.result.filterOptions?.campaigns?.length ? a.result.filterOptions.campaigns : o.campaigns,
      }));
    });
    return () => {
      live = false;
    };
  }, [from, to, agent, campaign, team, repRange, tick]);

  const s = d.s || {};
  const t = s.totals || {};
  const loading = d.loading;
  const dispLabel = (code) => (meta.dispositions || []).find((x) => x.code === code)?.label || (s.filterOptions?.dispositions || []).find((x) => x.key === code)?.label || code || "—";
  const rows = useMemo(() => {
    const [k, dir] = sort;
    return [...(s.rows || [])].filter((r) => r.calls || r.missed).sort((a, b) => {
      const x = a[k] ?? 0;
      const y = b[k] ?? 0;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
    });
  }, [s.rows, sort]);
  const missedRows = [...(s.rows || [])].filter((r) => r.missed).sort((a, b) => b.missed - a.missed);
  const mm = Math.max(1, ...missedRows.map((r) => r.missed));

  // area chart
  const trend = s.trend || [];
  const W = 720;
  const mx = Math.max(1, ...trend.map((x) => x.calls || 0));
  const X = (i) => (trend.length <= 1 ? 375 : 60 + (i * (W - 100)) / (trend.length - 1));
  const Y = (v) => Math.round(190 - ((v || 0) / mx) * 160);
  const line = (k) => trend.map((x, i) => `${X(i)},${Y(x[k])}`).join(" ");
  const area = (k) => (trend.length ? `M${X(0)} 190 L${trend.map((x, i) => `${X(i)} ${Y(x[k])}`).join(" L")} L${X(trend.length - 1)} 190 Z` : "");
  const hourly = trend.length && String(trend[0].key).length > 10;
  const every = Math.max(1, Math.ceil(trend.length / 8));
  const xLabel = (k) => (hourly ? `${Number(String(k).slice(11, 13))}:00` : trend.length <= 8 ? dayjs(k).format("ddd") : dayjs(k).format("D MMM"));

  // pie
  const outcomes = (s.outcomes || []).filter((o) => o.n > 0);
  const outTotal = outcomes.reduce((a, o) => a + o.n, 0);
  let extra = 0;
  const outColor = (k) => (OUT[k] ? OUT[k][1] : OUT_MORE[extra++ % OUT_MORE.length]);
  const C = 2 * Math.PI * 8;
  let acc = 0;
  const pie = outcomes.map((o) => {
    const p = (o.n / outTotal) * 100;
    const seg = { key: o.key, n: OUT[o.key]?.[0] || String(o.key).replace(/-/g, " "), c: outColor(o.key), pct: Math.round(p), v: o.n, da: `${((p / 100) * C).toFixed(2)} ${C.toFixed(2)}`, off: (-(acc / 100) * C).toFixed(2) };
    acc += p;
    return seg;
  });

  // dispositions
  const disp = s.dispositions || [];
  const dispTotal = disp.reduce((a, x) => a + x.n, 0);
  const dispMax = Math.max(1, ...disp.map((x) => x.n));

  // heat — connect rate by weekday × hour
  const heat = s.heat || [];
  const cellOf = (di, h) => (heat[di] && heat[di][h]) || { calls: 0, connected: 0 };
  const rates = [];
  heat.forEach((row, di) => HOURS.forEach((h) => { const c = cellOf(di, h); if (c.calls) rates.push(c.connected / c.calls); }));
  const maxRate = Math.max(0.0001, ...rates);
  const lvl = (c) => (!c.calls ? "h0" : c.connected / c.calls / maxRate > 0.75 ? "h4" : c.connected / c.calls / maxRate > 0.5 ? "h3" : c.connected / c.calls / maxRate > 0.25 ? "h2" : "h1");
  const heatRows = DAYS.map((name, di) => ({ name, di })).filter(({ di }) => HOURS.some((h) => cellOf(di, h).calls));

  const dt = d.dial?.totals || {};
  const dialCph = dt.dialerMin ? Math.round(((dt.calls || 0) / (dt.dialerMin / 60)) * 10) / 10 : null;
  const dialUse = dt.dialerUse ?? (dt.activeMin ? Math.round((dt.dialerMin / dt.activeMin) * 100) : null);
  const connectRate = t.calls ? Math.round(((t.connected || 0) / t.calls) * 100) : 0;
  const avgSec = t.avgTalkSec ?? (t.connected ? Math.round((t.talkSec || 0) / t.connected) : 0);

  const exportCsv = () => {
    if (!d.s) return;
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const out = [
      ["Call Reports", `${from.format("D MMM YYYY")} – ${to.format("D MMM YYYY")}`],
      [],
      ["Calls made", t.calls || 0], ["Connected", t.connected || 0], ["Connect rate %", connectRate], ["Avg duration (s)", avgSec], ["Total talk (s)", t.talkSec || 0], ["Missed by agent", t.missed || 0],
      [],
      ["Agent", "Dialled", "Talked", "Connect rate %", "Talk (s)", "Missed", "Calls / hr"],
      ...rows.map((r) => [r.name, r.calls, r.connected, r.connectRate, r.talkSec, r.missed, r.callsPerHour]),
      [],
      ["Outcome", "Calls"], ...pie.map((p) => [p.n, p.v]),
      [],
      ["Disposition", "Calls"], ...disp.map((x) => [dispLabel(x.key), x.n]),
    ];
    const blob = new Blob([out.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `call-reports-${from.format("YYYY-MM-DD")}-${to.format("YYYY-MM-DD")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    message.success("CSV downloaded.");
  };

  const kpis = [
    ["Calls made", nf(t.calls), "dialled in this range", "d mut", "workday/admin/360 → totals.calls"],
    ["Connected", nf(t.connected), "customer + agent spoke", "d mut", "workday/admin/360 → totals.connected"],
    ["Connect rate", `${connectRate}%`, "was “Answer Rate”", "d mut", "connected ÷ calls"],
    ["Avg duration", talk(avgSec), "per connected call", "d mut", "workday/admin/360 → totals.avgTalkSec"],
    ["Total talk time", talk(t.talkSec), "", "d mut", "workday/admin/360 → totals.talkSec"],
    ["Missed by agent", nf(t.missed), "rang, not picked", "d dn", "workday/admin/360 → totals.missed"],
  ];

  return (
    <>
      <Head crumb="Sales › Call Reports" title="Call Reports" lead="Every call number and chart, once, for the range you pick.">
        <button type="button" className="btn" disabled={!d.s || loading} onClick={exportCsv}>Export CSV</button>
      </Head>
      <section className="fp" aria-label="Filters">
        <div className="row">
          <div className="seg" role="group" aria-label="Date">
            {PRESETS.map(([k, l]) => <button key={k} type="button" className={preset === k ? "on" : ""} onClick={() => setPreset(k)}>{l}</button>)}
          </div>
          {preset === "custom" && (
            <>
              <input className="in" type="date" aria-label="From" style={{ width: "auto" }} value={cr.from} max={cr.to || undefined} onChange={(e) => setCr({ ...cr, from: e.target.value })} />
              <input className="in" type="date" aria-label="To" style={{ width: "auto" }} value={cr.to} min={cr.from || undefined} onChange={(e) => setCr({ ...cr, to: e.target.value })} />
            </>
          )}
          <span className="sp" />
          {opts.people.length > 1 && (
            <label className="fld" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>Agent
              <select className="sel" style={{ width: "auto" }} value={agent} onChange={(e) => setAgent(e.target.value)}>
                <option value="">All agents</option>
                {opts.people.map((p) => <option key={p.adminId} value={p.adminId}>{p.name}</option>)}
              </select>
            </label>
          )}
          <label className="fld" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>Campaign
            <select className="sel" style={{ width: "auto" }} value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">All campaigns</option>
              {opts.campaigns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          {opts.teams.length > 0 && (
            <label className="fld" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>Team
              <select className="sel" style={{ width: "auto" }} value={team} onChange={(e) => setTeam(e.target.value)}>
                <option value="">All teams</option>
                {opts.teams.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          )}
        </div>
      </section>

      {preset === "custom" && !(cr.from && cr.to) ? <Empty text="Pick both dates." /> : (
        <>
          <div className="kpis">
            {kpis.map(([l, v, sub, dc, src]) => (
              <div key={l} className="kpi" title={`Data: ${src}`}>
                <div className="l">{l}</div>
                <div className="v">{loading ? <span className="skel" style={{ display: "block", height: 26, width: "60%" }} /> : d.error ? "—" : v}</div>
                <div className={dc}>{sub}</div>
              </div>
            ))}
          </div>
          {d.error && <Fail onRetry={() => setTick((x) => x + 1)} text="Couldn’t load the report." />}

          <div className="card">
            <div className="ch"><div><h3>Call activity</h3><p>Area chart · calls dialled and connected per {hourly ? "hour" : "day"}</p></div><span className="src">workday/admin/360 → trend</span></div>
            {loading ? <Skel h={220} /> : d.error ? <Fail onRetry={() => setTick((x) => x + 1)} /> : !trend.some((x) => x.calls) ? <Empty /> : (
              <>
                <svg viewBox={`0 0 ${W} 220`} width="100%" height="220" role="img" aria-label="Calls per day area chart">
                  <defs>
                    <linearGradient id="sv3g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#94A3B8" stopOpacity=".35" /><stop offset="1" stopColor="#94A3B8" stopOpacity="0" /></linearGradient>
                    <linearGradient id="sv3g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0F766E" stopOpacity=".45" /><stop offset="1" stopColor="#0F766E" stopOpacity="0" /></linearGradient>
                  </defs>
                  <line x1="40" y1="190" x2={W - 10} y2="190" stroke="#CFD8E1" />
                  <path d={area("calls")} fill="url(#sv3g1)" />
                  <polyline points={line("calls")} fill="none" stroke="#94A3B8" strokeWidth="2" />
                  <path d={area("connected")} fill="url(#sv3g2)" />
                  <polyline points={line("connected")} fill="none" stroke="#0F766E" strokeWidth="3" />
                  {trend.map((x, i) => (
                    <g key={x.key}>
                      <circle cx={X(i)} cy={Y(x.calls)} r="9" fill="transparent"><title>{`${xLabel(x.key)} · ${nf(x.calls)} dialled, ${nf(x.connected)} connected`}</title></circle>
                      {i % every === 0 && <text x={X(i)} y="208" fontSize="11" fill="#5B6B79" textAnchor="middle">{xLabel(x.key)}</text>}
                    </g>
                  ))}
                </svg>
                <div className="legend"><span><i className="dot" style={{ background: "#94A3B8" }} />Dialled</span><span><i className="dot" style={{ background: "#0F766E" }} />Connected</span></div>
              </>
            )}
          </div>

          <div className="g2">
            <div className="card">
              <div className="ch"><div><h3>Call outcomes</h3><p>Pie · what happened to every call</p></div><span className="src">workday/admin/360 → outcomes</span></div>
              {loading ? <Skel h={190} /> : !outTotal ? <Empty /> : (
                <div className="row" style={{ gap: 24, alignItems: "center" }}>
                  <svg width="180" height="180" viewBox="0 0 32 32" role="img" aria-label="Call outcome pie" style={{ transform: "rotate(-90deg)" }}>
                    {pie.map((p) => <circle key={p.key} r="8" cx="16" cy="16" fill="none" stroke={p.c} strokeWidth="16" strokeDasharray={p.da} strokeDashoffset={p.off}><title>{`${p.n}: ${p.pct}% (${nf(p.v)} calls)`}</title></circle>)}
                  </svg>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, flex: 1, minWidth: 180 }}>
                    {pie.map((p) => <div key={p.key} className="row" style={{ gap: 8 }} title={`${nf(p.v)} calls`}><i className="dot" style={{ background: p.c }} /><span style={{ flex: 1, textTransform: OUT[p.key] ? "none" : "capitalize" }}>{p.n}</span><b>{p.pct}%</b></div>)}
                  </div>
                </div>
              )}
            </div>
            <div className="card">
              <div className="ch"><div><h3>Saved response after talking</h3><p>Dispositions</p></div><span className="src">workday/admin/360 → dispositions</span></div>
              {loading ? <Skel h={190} /> : !disp.length ? <Empty /> : disp.map((x, i) => {
                const p = dispTotal ? Math.round((x.n / dispTotal) * 100) : 0;
                return (
                  <div key={x.key} className="hb" title={`${dispLabel(x.key)}: ${nf(x.n)} calls`}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dispLabel(x.key)}</span>
                    <span className="t"><b style={{ width: `${(x.n / dispMax) * 100}%`, background: DISP_C[i % DISP_C.length] }} /></span>
                    <span className="n">{p}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card heat">
            <div className="ch"><div><h3>When customers pick up</h3><p>Heatmap · connect rate by weekday × hour (hover a cell)</p></div><span className="src">workday/admin/360 → heat</span></div>
            {loading ? <Skel h={200} /> : !heatRows.length ? <Empty /> : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead><tr><th scope="col" />{HOURS.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                    <tbody>
                      {heatRows.map(({ name, di }) => (
                        <tr key={name}>
                          <th scope="row" style={{ textAlign: "left" }}>{name}</th>
                          {HOURS.map((h) => {
                            const c = cellOf(di, h);
                            return <td key={h} className={lvl(c)} title={`${name} ${h}:00 — ${c.calls ? `connect rate ${Math.round((c.connected / c.calls) * 100)}% (${nf(c.connected)} of ${nf(c.calls)})` : "no calls"}`} />;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="legend" style={{ marginTop: 8 }}><span>Low</span><i className="dot h1" /><i className="dot h2" /><i className="dot h3" /><i className="dot h4" /><span>High</span></div>
              </>
            )}
          </div>

          <div className="card">
            <div className="ch"><div><h3>Agent performance</h3><p>The only leaderboard · click a header to sort</p></div><span className="src">workday/admin/360 → rows</span></div>
            {loading ? <Skel h={200} /> : !rows.length ? <Empty /> : (
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      {COLS.map(([k, l]) => (
                        <th key={k} scope="col" className={k === "name" ? "s" : "s num"} aria-sort={sort[0] === k ? (sort[1] < 0 ? "descending" : "ascending") : "none"} onClick={() => setSort([k, sort[0] === k ? -sort[1] : -1])} onKeyDown={(e) => e.key === "Enter" && setSort([k, sort[0] === k ? -sort[1] : -1])} tabIndex={0}>
                          {l} {sort[0] === k ? (sort[1] < 0 ? "↓" : "↑") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.adminId}>
                        <td><span className="who"><span className="av">{initials(r.name)}</span><AgentLnk adminId={r.adminId} name={r.name} /></span></td>
                        <td className="num">{nf(r.calls)}</td>
                        <td className="num">{nf(r.connected)}</td>
                        <td className="num">{r.connectRate ?? 0}%</td>
                        <td className="num">{talk(r.talkSec)}</td>
                        <td className="num">{nf(r.missed)}</td>
                        <td className="num">{r.callsPerHour ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="g2">
            <div className="card">
              <div className="ch"><div><h3>Missed calls by agent</h3><p>Rang for the agent, not picked</p></div><span className="src">workday/admin/360 → rows.missed</span></div>
              {loading ? <Skel h={160} /> : !missedRows.length ? <Empty text="No missed calls in this range." /> : missedRows.map((r) => (
                <div key={r.adminId} className="hb">
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><AgentLnk adminId={r.adminId} name={r.name} /></span>
                  <span className="t"><b style={{ width: `${(r.missed / mm) * 100}%`, background: "#EA580C" }} /></span>
                  <span className="n">{nf(r.missed)}</span>
                </div>
              ))}
              <div className="also" style={{ marginTop: 10 }}><a href="/sales-v3/history">See the missed calls list → Call History</a></div>
            </div>
            <div className="card">
              <div className="ch"><div><h3>Campaign performance · Dialer use</h3><p>Campaigns: {repLabel}</p></div><span className="src">calling/reports → campaigns · dialer-report</span></div>
              {loading ? <Skel h={160} /> : (
                <>
                  {!(d.rep?.campaignPerformance || []).length ? <Empty /> : (
                    <div className="tw">
                      <table style={{ minWidth: 440 }}>
                        <thead><tr><th scope="col">Campaign</th><th scope="col" className="num">Calls</th><th scope="col" className="num">Connect</th></tr></thead>
                        <tbody>
                          {d.rep.campaignPerformance.map((c) => (
                            <tr key={c.campaign}><td>{c.campaign}</td><td className="num">{nf(c.made)}</td><td className="num">{c.answerRate}%</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="kv" style={{ marginTop: 12 }}>
                    <span>Full-shift capacity</span><span>{dt.shiftRatio != null ? `${dt.shiftRatio}% used` : "—"}</span>
                    <span>Calls / hour of dialer</span><span>{dialCph != null ? `${dialCph} per person` : "—"}</span>
                    <span>Dialer use</span><span>{dialUse != null ? `${dialUse}% of logged-in time` : "—"}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
