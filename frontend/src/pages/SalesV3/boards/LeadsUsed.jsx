import React, { useEffect, useImperativeHandle, useMemo, useState, forwardRef } from "react";
import dayjs from "dayjs";
import { message } from "antd";
import { request } from "@/request";
import { STAGE_NAMES } from "@/config/leadStages";
import { Pager, Empty, Fail, Skel, nf, fmtWhen, stageBadge, IST } from "../ui";
import { AgentLnk, LeadLnk, usePopups } from "../popups/Popups";

// v3 design — S3UsedLeads. "Used" = a number a Sales user dialled in the range
// (same meaning as Sales 360° › Used leads). Data, all real:
//   workday/admin/360/leads-report → kpis (total / connected), trend (new numbers
//                                    by first call), byUser (last called by)
//   workday/admin/360              → totals.calls / totals.unique (calls per lead)
//   workday/admin/360/lead-list    → the table (by, stage, kpi, q, page, items)
const RANGES = [
  ["today", "Today", () => [dayjs().startOf("day"), dayjs()]],
  ["7d", "7 days", () => [dayjs().subtract(6, "day").startOf("day"), dayjs()]],
  ["30d", "30 days", () => [dayjs().subtract(29, "day").startOf("day"), dayjs()]],
  ["custom", "Custom", null],
];
const RESULTS = [
  ["connected", "Connected"],
  ["noResponse", "No response"],
  ["notInterested", "Not interested"],
  ["enrolled", "Enrolled"],
];
const BLANK = { q: "", range: "7d", from: "", to: "", by: "", stage: "", kpi: "" };
const todayKey = () => new Date().toLocaleDateString("en-CA", IST);

function rangeOf(f) {
  if (f.range === "custom") {
    const a = f.from ? dayjs(f.from).startOf("day") : dayjs().subtract(6, "day").startOf("day");
    const b = f.to ? dayjs(f.to).endOf("day") : dayjs();
    return [a, b];
  }
  return (RANGES.find((r) => r[0] === f.range) || RANGES[1])[2]();
}

const LeadsUsed = forwardRef(function LeadsUsed(_, ref) {
  const { openLead } = usePopups();
  const [draft, setDraft] = useState(BLANK);
  const [f, setF] = useState(BLANK);
  const [rep, setRep] = useState({ data: null, loading: true, error: false });
  const [sum, setSum] = useState(null);
  const [list, setList] = useState({ rows: [], count: 0, pages: 1, loading: true, error: false });
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(20);
  const [tick, setTick] = useState(0);

  const base = useMemo(() => {
    const [a, b] = rangeOf(f);
    return { from: a.toISOString(), to: b.toISOString() };
  }, [f]);

  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams(base).toString();
    setRep({ data: null, loading: true, error: false });
    setSum(null);
    request.get({ entity: `workday/admin/360/leads-report?${qs}` }).then((r) => {
      if (!live) return;
      setRep(r?.success ? { data: r.result, loading: false, error: false } : { data: null, loading: false, error: true });
    });
    request.get({ entity: `workday/admin/360?${qs}` }).then((r) => live && r?.success && setSum(r.result?.totals || null));
    return () => {
      live = false;
    };
  }, [base, tick]);

  const listQuery = (pg, items) => {
    const p = new URLSearchParams({ ...base, page: String(pg), items: String(items) });
    ["q", "by", "stage", "kpi"].forEach((k) => f[k] && p.set(k, f[k]));
    return p.toString();
  };
  useEffect(() => {
    let live = true;
    setList((l) => ({ ...l, loading: true, error: false }));
    request.get({ entity: `workday/admin/360/lead-list?${listQuery(page, per)}` }).then((r) => {
      if (!live) return;
      if (r?.success) setList({ rows: r.result || [], count: r.pagination?.count || 0, pages: r.pagination?.pages || 1, loading: false, error: false });
      else setList({ rows: [], count: 0, pages: 1, loading: false, error: true });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, f, page, per, tick]);

  const apply = (n) => {
    setF(n);
    setDraft(n);
    setPage(1);
  };

  // Export CSV — every row of the current filters, page by page.
  useImperativeHandle(ref, () => ({
    exportCsv: async () => {
      const hide = message.loading("Preparing the CSV…", 0);
      try {
        const all = [];
        for (let pg = 1; pg <= 100; pg += 1) {
          const r = await request.get({ entity: `workday/admin/360/lead-list?${listQuery(pg, 200)}` });
          if (!r?.success) throw new Error(r?.message || "Could not load the list.");
          all.push(...(r.result || []));
          if (pg >= (r.pagination?.pages || 1)) break;
        }
        const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const head = ["Lead", "Phone", "Stage now", "Source", "Last called by", "Last called", "Calls", "Last result"];
        const lines = all.map((l) => [l.name, l.phone, l.stage, l.source, l.by, l.lastAt ? new Date(l.lastAt).toLocaleString("en-IN", IST) : "", l.calls, l.connected ? "Connected" : "Not picked"].map(esc).join(","));
        const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `used-leads-${todayKey()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
        message.success(`${nf(all.length)} leads exported.`);
      } catch (e) {
        message.error(e.message || "Export failed.");
      } finally {
        hide();
      }
    },
  }));

  const d = rep.data;
  const kpiOf = (k) => (d?.kpis || []).find((x) => x.key === k)?.value || 0;
  const total = kpiOf("total");
  const tk = todayKey();
  const trend = d?.trend || [];
  const fresh = trend.filter((t) => String(t.key).startsWith(tk)).reduce((a, t) => a + (t.n || 0), 0);
  const perLead = sum && sum.unique ? Math.round((sum.calls / sum.unique) * 10) / 10 : null;
  const byUser = (d?.byUser || []).filter((u) => u.key && u.key !== "—").slice(0, 8);
  const maxU = Math.max(1, ...byUser.map((u) => u.n));
  const hourly = trend.length && String(trend[0].key).length > 10;
  const maxD = Math.max(1, ...trend.map((t) => t.n));
  const every = trend.length > 16 ? Math.ceil(trend.length / 12) : 1;
  const dayLbl = (k) => {
    if (hourly) return `${Number(String(k).slice(11, 13))}:00`;
    if (k === tk) return "Today";
    return new Date(`${k}T12:00:00`).toLocaleDateString("en-IN", trend.length > 8 ? { day: "numeric", month: "short" } : { weekday: "short" });
  };
  const users = useMemo(() => (d?.byUser || []).map((u) => u.key).filter((k) => k && k !== "—"), [d]);

  const pills = [
    f.q && ["q", `Search: ${f.q}`],
    f.by && ["by", `Last called by: ${f.by}`],
    f.stage && ["stage", `Stage now: ${f.stage}`],
    f.kpi && ["kpi", `Result: ${RESULTS.find((r) => r[0] === f.kpi)?.[1] || f.kpi}`],
  ].filter(Boolean);

  const tile = (icon, label, value, sub, warn) => (
    <div className="kpi">
      <div className="l"><i style={warn ? { background: "#FEF0E6", color: "#B54708" } : undefined}>{icon}</i>{label}</div>
      <div className="v">{rep.loading ? <span className="skel" style={{ display: "block", height: 26, width: "60%" }} /> : value}</div>
      <div className={warn ? "d dn" : "d mut"}>{sub}</div>
    </div>
  );

  return (
    <>
      <div className="kpis">
        {tile("↺", "Used leads", nf(total), "called at least once")}
        {tile("☎", "New numbers called", nf(fresh), "first call today")}
        {tile("#", "Calls per lead", perLead == null ? "—" : perLead, "average")}
        {tile("!", "Never connected", nf(Math.max(0, total - kpiOf("connected"))), "rang, nobody spoke", true)}
      </div>

      <div className="g2">
        <div className="card">
          <div className="ch"><div><h3>Used leads by user</h3><p>Horizontal bar · last called by · click a name to filter</p></div><span className="src">workday/admin/360/leads → usedBy</span></div>
          {rep.error ? <Fail onRetry={() => setTick((x) => x + 1)} /> : rep.loading ? <Skel h={180} /> : byUser.length === 0 ? <Empty /> : byUser.map((u) => (
            <div key={u.key} className="hb" style={{ cursor: "pointer" }} role="button" tabIndex={0} onClick={() => apply({ ...f, by: f.by === u.key ? "" : u.key })} onKeyDown={(e) => e.key === "Enter" && apply({ ...f, by: f.by === u.key ? "" : u.key })}>
              <span style={f.by === u.key ? { fontWeight: 700, color: "#0F766E" } : { fontWeight: 600 }}>{u.key}</span>
              <span className="t"><b style={{ width: `${(u.n / maxU) * 100}%`, background: f.by === u.key ? "#0F766E" : "#5EC4B6" }} /></span>
              <span className="n">{nf(u.n)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="ch"><div><h3>New numbers called per {hourly ? "hour" : "day"}</h3><p>Bar chart · first-time calls</p></div><span className="src">calling/lead-pool/used-leads → day</span></div>
          {rep.error ? <Fail onRetry={() => setTick((x) => x + 1)} /> : rep.loading ? <Skel h={200} /> : !trend.some((t) => t.n) ? <Empty /> : (
            <>
              <div style={{ display: "flex", alignItems: "flex-end", gap: trend.length > 16 ? 3 : 10, height: 180, borderBottom: "1px solid #CFD8E1", padding: "0 4px" }}>
                {trend.map((t) => (
                  <div key={t.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 4, minWidth: 0 }} title={`${dayLbl(t.key)}: ${nf(t.n)} new numbers`}>
                    {trend.length <= 16 && <b style={{ fontSize: 11.5 }}>{nf(t.n)}</b>}
                    <i style={{ display: "block", width: "100%", maxWidth: 44, borderRadius: "6px 6px 2px 2px", background: String(t.key).startsWith(tk) && !hourly ? "#CBD5E1" : "#0F766E", height: `${(t.n / maxD) * 100}%`, minHeight: t.n ? 2 : 0 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: trend.length > 16 ? 3 : 10, padding: "6px 4px 0" }}>
                {trend.map((t, i) => <span key={t.key} style={{ flex: 1, textAlign: "center", fontSize: 11.5, color: "#5B6B79", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>{i % every === 0 ? dayLbl(t.key) : ""}</span>)}
              </div>
            </>
          )}
        </div>
      </div>

      <section className="fp" aria-label="Filters">
        <div className="row">
          <label className="srch">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5B6B79" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" /></svg>
            <input type="search" placeholder="Search name or phone…" aria-label="Search used leads" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && apply({ ...draft, q: e.currentTarget.value })} />
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
          <label className="fld">Last called by
            <select className="sel" value={draft.by} onChange={(e) => setDraft({ ...draft, by: e.target.value })}>
              <option value="">All users</option>
              {users.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="fld">Stage now
            <select className="sel" value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value })}>
              <option value="">All stages</option>
              {[...STAGE_NAMES, "Not in CRM"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="fld">Last result
            <select className="sel" value={draft.kpi} onChange={(e) => setDraft({ ...draft, kpi: e.target.value })}>
              <option value="">All results</option>
              {RESULTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        <div className="factions">
          <div className="applied">
            {pills.map(([k, l]) => <button key={k} type="button" className="pill" onClick={() => apply({ ...f, [k]: "" })}>{l} ✕</button>)}
            <span className="mut" style={{ fontSize: 12.5 }}>{list.loading ? "Loading…" : `${nf(list.count)} leads`}</span>
          </div>
          <div className="row">
            <button type="button" className="btn g" onClick={() => apply(BLANK)}>Reset</button>
            <button type="button" className="btn p" onClick={() => apply(draft)}>Apply</button>
          </div>
        </div>
      </section>

      <div className="tw">
        <table>
          <thead>
            <tr>
              <th scope="col">Lead</th><th scope="col">Stage now</th><th scope="col">Last called by</th><th scope="col" className="s">Last called ↓</th>
              <th scope="col" className="num">Calls</th><th scope="col">Last result</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.loading && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={7}><div className="skel" style={{ height: 22 }} /></td></tr>)}
            {!list.loading && list.rows.map((l) => (
              <tr key={l.key || l._id}>
                <td><LeadLnk phone={l.phone} ink>{l.name || "—"}</LeadLnk><div className="mut" style={{ fontSize: 12 }}>{l.phone}</div></td>
                <td><span className={l.stage === "Not in CRM" ? "b gy" : stageBadge(l.stage)}>{l.stage}</span></td>
                <td>{l.by && l.by !== "—" ? <AgentLnk name={l.by} /> : "—"}</td>
                <td>{fmtWhen(l.lastAt)}</td>
                <td className="num">{nf(l.calls)}</td>
                <td><span className={l.connected ? "b gr" : "b gy"}>{l.connected ? "Connected" : "Not picked"}</span></td>
                <td><button type="button" className="btn sm" onClick={() => openLead({ phone: l.phone })}>Calls →</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.loading && list.error && <Fail onRetry={() => setTick((x) => x + 1)} text="Couldn’t load the used leads." />}
      {!list.loading && !list.error && list.rows.length === 0 && <Empty action={pills.length ? <button type="button" className="btn sm" onClick={() => apply(BLANK)}>Reset filters</button> : null} />}
      {list.count > 0 && <Pager page={page} pages={list.pages} count={list.count} per={per} pers={[8, 20, 50, 100]} onPer={(n) => { setPer(n); setPage(1); }} onPage={setPage} noun="leads" />}
    </>
  );
});

export default LeadsUsed;
