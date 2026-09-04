import React, { useEffect, useMemo, useState } from "react";
import { request } from "@/request";
import { NotificationOutlined, SettingOutlined, DollarOutlined, ReloadOutlined, DeleteOutlined, TableOutlined } from "@ant-design/icons";
import ChartCanvas, { Gauge, PALETTE, fillRgba } from "@/pages/SalesDashboard/ChartCanvas";

const BUSINESS_FILTERS = [
  { key: "all", label: "All Business" },
  { key: "b2b-india", label: "B2B System India", businessType: "B2B", region: "India" },
  { key: "b2c-india", label: "B2C System India", businessType: "B2C", region: "India" },
  { key: "b2b-usa", label: "B2B System USA", businessType: "B2B", region: "USA" },
  { key: "b2c-usa", label: "B2C System USA", businessType: "B2C", region: "USA" },
];
const SYSTEM_FILTERS = [
  { key: "combined", label: "Combined System" },
  { key: "human-india", label: "Human System India", systemType: "Human", region: "India" },
  { key: "human-usa", label: "Human System USA", systemType: "Human", region: "USA" },
  { key: "ai-india", label: "AI System India", systemType: "AI", region: "India" },
  { key: "ai-usa", label: "AI System USA", systemType: "AI", region: "USA" },
];
const RANGES = { "30D": 30, "90D": 90, "6M": 182, "1Y": 365 };
const BUSINESS_TYPES = ["B2B", "B2C"];
const REGIONS = ["India", "USA"];
const SYSTEM_TYPES = ["Human", "AI"];
const SOURCES = ["Facebook Ads", "Google Ads", "LinkedIn Ads", "YouTube", "GMB", "Website", "Referral", "PPC", "Meta", "Other"];

const pct1 = (v) => `${((v || 0) * 100).toFixed(1)}%`;
const money = (v) => `₹${Math.round(v || 0).toLocaleString()}`;
const mult = (v) => `${(v || 0).toFixed(2)}×`;
const fmtSec = (s) => { s = Math.round(s || 0); const m = Math.floor(s / 60); return s < 60 ? `${s}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };

function Grid({ min = 300, children }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 14 }}>{children}</div>;
}
function barOpts({ horizontal = false, pct = false, mny = false, max } = {}) {
  const v = horizontal ? "x" : "y", c = horizontal ? "y" : "x";
  return {
    indexAxis: horizontal ? "y" : "x",
    layout: { padding: { right: horizontal ? 56 : 12, top: 22, left: 2, bottom: 2 } },
    scales: {
      [v]: { beginAtZero: true, max, grid: { color: PALETTE.grid, drawBorder: false }, border: { display: false }, ticks: { callback: (x) => (pct ? `${x}%` : mny ? money(x) : x) } },
      [c]: { grid: { display: false, drawBorder: false }, border: { display: false }, ticks: { color: PALETTE.ink, font: { weight: "600" } } },
    },
    plugins: { legend: { display: false }, valueLabels: { fmt: (x) => (pct ? `${x.toFixed(1)}%` : mny ? money(x) : Math.round(x * 10) / 10) } },
    borderRadius: 8, borderSkipped: false, barPercentage: 0.62, categoryPercentage: 0.72, hoverBorderColor: "#fff", hoverBorderWidth: 2,
  };
}

export default function MarketingDashboard() {
  const [biz, setBiz] = useState("all");
  const [sys, setSys] = useState("combined");
  const [range, setRange] = useState("90D");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [numbers, setNumbers] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const [cfg, setCfg] = useState({ teams: [], costs: [] });

  const query = useMemo(() => {
    const b = BUSINESS_FILTERS.find((x) => x.key === biz) || {};
    const s = SYSTEM_FILTERS.find((x) => x.key === sys) || {};
    const to = new Date();
    const from = new Date(to.getTime() - RANGES[range] * 86400000);
    const q = { from: from.toISOString(), to: to.toISOString() };
    if (b.businessType) q.businessType = b.businessType;
    if (b.region) q.region = b.region;
    if (s.systemType) q.systemType = s.systemType;
    if (s.region) q.region = s.region;
    return q;
  }, [biz, sys, range]);

  const load = async () => {
    setLoading(true); setError("");
    const r = await request.get({ entity: `sales-dashboard/marketing?${new URLSearchParams(query)}` });
    if (r?.success) setData(r.result); else setError(r?.message || "Failed to load.");
    setLoading(false);
  };
  const loadCfg = async () => {
    const r = await request.get({ entity: "sales-dashboard/config" });
    if (r?.success) setCfg(r.result);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [query]);
  useEffect(() => { loadCfg(); }, []);

  const t = data?.totals || {};
  const ra = data?.ratios || {};
  const rv = (k) => ra[k]?.value || 0;
  const trend = data?.trend || [];
  const srcRoi = data?.bySourceRoi || [];

  return (
    <div className="hub-stack" style={{ minWidth: 0 }}>
      <div className="hub-card">
        <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 10 }}>
          <h3><NotificationOutlined /> Marketing — B2B / B2C Combined Dashboard</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <select className="hub-select" style={{ maxWidth: 96 }} value={range} onChange={(e) => setRange(e.target.value)}>
              {Object.keys(RANGES).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button type="button" className="hub-btn" onClick={load}><ReloadOutlined /> Refresh</button>
            <button type="button" className={`hub-btn ${numbers ? "hub-btn-primary" : ""}`} onClick={() => setNumbers((v) => !v)}><TableOutlined /> Numbers</button>
            <button type="button" className={`hub-btn ${showCfg ? "hub-btn-primary" : ""}`} onClick={() => setShowCfg((v) => !v)}><SettingOutlined /> Systems</button>
            <button type="button" className={`hub-btn ${showCost ? "hub-btn-primary" : ""}`} onClick={() => setShowCost((v) => !v)}><DollarOutlined /> Costs</button>
          </div>
        </div>
        <ChipRow value={biz} onChange={setBiz} items={BUSINESS_FILTERS} tone={PALETTE.blue} />
        <div style={{ marginTop: 8 }}><ChipRow value={sys} onChange={setSys} items={SYSTEM_FILTERS} tone={PALETTE.purple} /></div>
        <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 10 }}>
          {loading ? "Loading…" : data ? `${data.system} · ${t.leads || 0} leads · ${money(t.cost?.marketing)} marketing spend · ${range}` : ""}
          {data?.note && <span className="hub-badge hub-badge-yellow" style={{ marginLeft: 8 }}>{data.note}</span>}
        </div>
      </div>

      {error && <div className="hub-card"><div className="hub-empty">{error}</div></div>}
      {showCfg && <SystemConfig cfg={cfg} onSaved={() => { loadCfg(); load(); }} />}
      {showCost && <CostEditor cfg={cfg} onSaved={() => { loadCfg(); load(); }} />}

      {!loading && data && (
        <>
          {/* cost KPIs */}
          <Grid min={150}>
            <Mini label="Cost per Lead" value={money(rv("costPerLead"))} tone={PALETTE.blue} />
            <Mini label="Lead Qualification Cost" value={money(rv("leadQualificationCost"))} tone={PALETTE.cyan} />
            <Mini label="Cost per Calling" value={money(rv("costPerCalling"))} tone={PALETTE.amber} />
            <Mini label="Marketing CAC" value={money(rv("marketingCac"))} tone={PALETTE.purple} />
            <Mini label="Cost vs Conversion" value={money(rv("marketingCostVsConversion"))} tone={PALETTE.pink} />
            <Mini label="ROMS" value={mult(rv("roms"))} tone={rv("roms") >= 1 ? "#0d9488" : "#dc2626"} />
            <Mini label="ROI" value={pct1(rv("roi"))} tone={rv("roi") >= 0 ? "#0d9488" : "#dc2626"} />
            <Mini label="₹ Revenue Prediction" value={mult(rv("perRupeeRevenuePrediction"))} tone="#7c3aed" />
          </Grid>

          {/* rate gauges */}
          <div className="hub-card">
            <div className="hub-card-header"><h3>Lead Rates (vs all leads)</h3></div>
            <Grid min={160}>
              <Gauge value={rv("firstResponse")} label="First Response" color={PALETTE.blue} />
              <Gauge value={rv("noResponse")} label="No Response" color={PALETTE.red} />
              <Gauge value={rv("dialVsConnectivity")} label="Leads vs Connectivity" color={PALETTE.green} />
              <Gauge value={rv("leadToSalesMeeting")} label="Lead → Sales Meeting" color={PALETTE.blue} />
              <Gauge value={rv("salesMeetingToEnrolled")} label="All Leads → Enrolled" color={PALETTE.green} />
              <Gauge value={rv("allLeadsToDead")} label="→ Not Int./No Resp." color={PALETTE.red} />
            </Grid>
          </div>

          {/* trend */}
          <Card title="Monthly Trend" numbers={numbers} rows={trend.map((m) => [m.month, `${m.leads} leads · ${m.enrolled} enrolled`])}>
            <ChartCanvas type="line" height={250}
              data={{ labels: trend.map((m) => m.month), datasets: [
                { label: "Leads", data: trend.map((m) => m.leads), borderColor: PALETTE.blue, backgroundColor: fillRgba(PALETTE.blue, 0.16), fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5 },
                { label: "Enrolled", data: trend.map((m) => m.enrolled), borderColor: PALETTE.green, backgroundColor: fillRgba(PALETTE.green, 0.16), fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5 },
              ] }}
              options={{ interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, grid: { color: PALETTE.grid, drawBorder: false }, border: { display: false } }, x: { grid: { display: false, drawBorder: false }, border: { display: false } } }, plugins: { legend: { position: "bottom" }, valueLabels: false } }}
            />
          </Card>

          {/* source ROI */}
          <Card title="Lead Source — ROI &amp; Cost" numbers={numbers}
            rows={srcRoi.map((s) => [s.source, `${s.leads}L · spend ${money(s.spend)} · CPL ${money(s.costPerLead)} · ROI ${pct1(s.roi)} · ROMS ${mult(s.roms)}`])}>
            {srcRoi.length === 0 ? <div className="hub-empty">No source data.</div> : (
              <ChartCanvas type="bar" height={Math.max(200, srcRoi.length * 44)}
                data={{ labels: srcRoi.map((s) => s.source), datasets: [
                  { label: "ROI %", data: srcRoi.map((s) => s.roi * 100), backgroundColor: srcRoi.map((s) => (s.roi >= 0 ? PALETTE.green : PALETTE.red)) },
                ] }}
                options={{ ...barOpts({ horizontal: true, pct: true }), plugins: { legend: { display: false }, valueLabels: { fmt: (v) => `${v.toFixed(0)}%` }, tooltip: { callbacks: { label: (c) => { const s = srcRoi[c.dataIndex]; return `${s.leads} leads · ${s.enrolled} enrolled · spend ${money(s.spend)} · CPL ${money(s.costPerLead)} · ROMS ${mult(s.roms)}`; } } } } }}
              />
            )}
          </Card>

          {/* cost & revenue */}
          <Card title="Cost &amp; Revenue" numbers={numbers}
            rows={[["Marketing", money(t.cost?.marketing)], ["Agent", money(t.cost?.agent)], ["Other", money(t.cost?.other)], ["Revenue", money(t.cost?.revenue)]]}>
            <ChartCanvas type="bar" height={230}
              data={{ labels: ["Marketing", "Agent", "Other", "Revenue"], datasets: [{ data: [t.cost?.marketing || 0, t.cost?.agent || 0, t.cost?.other || 0, t.cost?.revenue || 0], backgroundColor: [PALETTE.amber, PALETTE.pink, PALETTE.cyan, PALETTE.green] }] }}
              options={barOpts({ mny: true })}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function Mini({ label, value, tone = "#0f172a" }) {
  return (
    <div style={{ minWidth: 0, background: "#f8fafc", border: "1px solid #eef0f4", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: tone, marginTop: 3 }}>{value}</div>
    </div>
  );
}
function NumbersTable({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 12 }}>
      <tbody>{rows.map(([k, v]) => (
        <tr key={k} style={{ borderTop: "1px solid #f1f5f9" }}>
          <td style={{ padding: "6px 4px", fontWeight: 600, color: "#475569" }}>{k}</td>
          <td style={{ padding: "6px 4px", textAlign: "right", color: "#0f172a", fontWeight: 700 }}>{v}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}
function Card({ title, children, rows, numbers }) {
  return <div className="hub-card" style={{ minWidth: 0 }}><div className="hub-card-header"><h3>{title}</h3></div>{children}{numbers && <NumbersTable rows={rows} />}</div>;
}
function ChipRow({ value, onChange, items, tone }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {items.map((it) => {
        const on = value === it.key;
        return (
          <button key={it.key} type="button" onClick={() => onChange(it.key)}
            style={{ padding: "5px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer", border: `1px solid ${on ? tone : "#e2e8f0"}`, background: on ? tone : "#fff", color: on ? "#fff" : "#475569" }}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
function SystemConfig({ cfg, onSaved }) {
  const [saving, setSaving] = useState("");
  const save = async (id, patch) => { setSaving(id); await request.patch({ entity: `sales-dashboard/team/${id}`, jsonData: patch }); setSaving(""); onSaved(); };
  return (
    <div className="hub-card">
      <div className="hub-card-header"><h3><SettingOutlined /> Classify Teams into Systems</h3></div>
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>Team</th><th>Business</th><th>Region</th><th>AI / Human</th></tr></thead>
          <tbody>
            {(cfg.teams || []).map((tm) => (
              <tr key={tm._id} style={saving === tm._id ? { opacity: 0.5 } : undefined}>
                <td style={{ fontWeight: 600 }}>{tm.name}</td>
                {[["businessType", BUSINESS_TYPES], ["region", REGIONS], ["systemType", SYSTEM_TYPES]].map(([k, opts]) => (
                  <td key={k}>
                    <select className="hub-select" value={tm[k] || ""} onChange={(e) => save(tm._id, { [k]: e.target.value })}>
                      <option value="">—</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function CostEditor({ cfg, onSaved }) {
  const [f, setF] = useState({ month: new Date().toISOString().slice(0, 7), businessType: "", region: "", systemType: "", source: "", marketingSpend: "", agentCost: "", otherCost: "", revenue: "", avgDealValue: "" });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => { await request.post({ entity: "sales-dashboard/cost", jsonData: f }); onSaved(); };
  const del = async (id) => { await request.delete({ entity: `sales-dashboard/cost/${id}` }); onSaved(); };
  const Sel = ({ k, opts }) => (<select className="hub-select" value={f[k]} onChange={set(k)}><option value="">—</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>);
  const L = ({ label, children }) => <div className="hub-form-row"><label>{label}</label>{children}</div>;
  return (
    <div className="hub-card">
      <div className="hub-card-header"><h3><DollarOutlined /> Monthly Marketing Cost / Revenue</h3></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,130px),1fr))", gap: 10 }}>
        <L label="Month"><input type="month" className="hub-input" value={f.month} onChange={set("month")} /></L>
        <L label="Business"><Sel k="businessType" opts={BUSINESS_TYPES} /></L>
        <L label="Region"><Sel k="region" opts={REGIONS} /></L>
        <L label="AI/Human"><Sel k="systemType" opts={SYSTEM_TYPES} /></L>
        <L label="Source (channel)"><Sel k="source" opts={SOURCES} /></L>
        <L label="Marketing Spend"><input className="hub-input" value={f.marketingSpend} onChange={set("marketingSpend")} /></L>
        <L label="Agent Cost"><input className="hub-input" value={f.agentCost} onChange={set("agentCost")} /></L>
        <L label="Other Cost"><input className="hub-input" value={f.otherCost} onChange={set("otherCost")} /></L>
        <L label="Revenue"><input className="hub-input" value={f.revenue} onChange={set("revenue")} /></L>
        <L label="Avg Deal Value"><input className="hub-input" value={f.avgDealValue} onChange={set("avgDealValue")} /></L>
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" className="hub-btn hub-btn-primary" onClick={save}>Save Cost Row</button>
        <span style={{ fontSize: 11.5, color: "#8c8c8c", marginLeft: 10 }}>Source-tagged rows drive per-source ROI; blank = whole slice.</span>
      </div>
      {(cfg.costs || []).length > 0 && (
        <div className="hub-table-wrapper" style={{ marginTop: 12 }}>
          <table className="hub-table">
            <thead><tr><th>Month</th><th>Slice</th><th>Source</th><th>Marketing</th><th>Revenue</th><th /></tr></thead>
            <tbody>
              {cfg.costs.map((c) => (
                <tr key={c._id}>
                  <td>{c.month}</td>
                  <td>{[c.businessType, c.region, c.systemType].filter(Boolean).join(" / ") || "All"}</td>
                  <td>{c.source || "—"}</td>
                  <td>{money(c.marketingSpend)}</td>
                  <td>{money(c.revenue)}</td>
                  <td><button type="button" className="hub-btn" style={{ padding: "3px 8px", color: "#dc2626" }} onClick={() => del(c._id)}><DeleteOutlined /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
