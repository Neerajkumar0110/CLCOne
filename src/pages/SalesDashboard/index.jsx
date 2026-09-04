import React, { useEffect, useMemo, useState } from "react";
import { request } from "@/request";
import {
  RiseOutlined,
  SettingOutlined,
  DollarOutlined,
  ReloadOutlined,
  DeleteOutlined,
  TableOutlined,
} from "@ant-design/icons";
import ChartCanvas, { Gauge, PALETTE, fillRgba } from "./ChartCanvas";

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

const SERIES = [PALETTE.blue, PALETTE.green, PALETTE.amber, PALETTE.purple, PALETTE.cyan, PALETTE.pink];

const pct1 = (v) => `${((v || 0) * 100).toFixed(1)}%`;
const money = (v) => `₹${Math.round(v || 0).toLocaleString()}`;
const hrs = (s) => Math.round(((s || 0) / 3600) * 10) / 10;
function fmtSec(s) {
  s = Math.round(s || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Grid({ min = 300, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 14 }}>
      {children}
    </div>
  );
}

function barOpts({ horizontal = false, pct = false, mny = false, max } = {}) {
  const valAxis = horizontal ? "x" : "y";
  const catAxis = horizontal ? "y" : "x";
  return {
    indexAxis: horizontal ? "y" : "x",
    layout: { padding: { right: horizontal ? 54 : 12, top: 22, left: 2, bottom: 2 } },
    scales: {
      [valAxis]: {
        beginAtZero: true,
        max,
        grid: { color: PALETTE.grid, drawBorder: false },
        border: { display: false },
        ticks: { callback: (v) => (pct ? `${v}%` : mny ? money(v) : v) },
      },
      [catAxis]: {
        grid: { display: false, drawBorder: false },
        border: { display: false },
        ticks: { color: PALETTE.ink, font: { weight: "600" }, autoSkip: false },
      },
    },
    plugins: {
      legend: { display: false },
      valueLabels: { fmt: (v) => (pct ? `${v.toFixed(1)}%` : mny ? money(v) : Math.round(v * 10) / 10) },
    },
    borderRadius: 8,
    borderSkipped: false,
    barPercentage: 0.62,
    categoryPercentage: 0.72,
    hoverBorderColor: "#ffffff",
    hoverBorderWidth: 2,
  };
}

export default function SalesDashboard() {
  const [biz, setBiz] = useState("all");
  const [sys, setSys] = useState("combined");
  const [range, setRange] = useState("90D");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCfg, setShowCfg] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const [numbers, setNumbers] = useState(false);
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
    if (sys === "combined") q.combined = "1";
    return q;
  }, [biz, sys, range]);

  const load = async () => {
    setLoading(true);
    setError("");
    const qs = new URLSearchParams(query).toString();
    const r = await request.get({ entity: `sales-dashboard/summary?${qs}` });
    if (r?.success) setData(r.result);
    else setError(r?.message || "Failed to load dashboard.");
    setLoading(false);
  };
  const loadCfg = async () => {
    const r = await request.get({ entity: "sales-dashboard/config" });
    if (r?.success) setCfg(r.result);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    loadCfg();
  }, []);

  const ratios = data?.ratios || {};
  const t = data?.totals || {};
  const rv = (k) => ratios[k]?.value || 0;
  const trend = data?.trend || [];

  return (
    <div className="hub-stack" style={{ minWidth: 0 }}>
      <div className="hub-card">
        <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 10 }}>
          <h3><RiseOutlined /> B2B / B2C Combined Dashboard</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <select className="hub-select" style={{ maxWidth: 96 }} value={range} onChange={(e) => setRange(e.target.value)}>
              {Object.keys(RANGES).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button type="button" className="hub-btn" onClick={load}><ReloadOutlined /> Refresh</button>
            <button type="button" className={`hub-btn ${numbers ? "hub-btn-primary" : ""}`} onClick={() => setNumbers((v) => !v)}>
              <TableOutlined /> Numbers
            </button>
            <button type="button" className={`hub-btn ${showCfg ? "hub-btn-primary" : ""}`} onClick={() => setShowCfg((v) => !v)}>
              <SettingOutlined /> Systems
            </button>
            <button type="button" className={`hub-btn ${showCost ? "hub-btn-primary" : ""}`} onClick={() => setShowCost((v) => !v)}>
              <DollarOutlined /> Costs
            </button>
          </div>
        </div>
        <ChipRow value={biz} onChange={setBiz} items={BUSINESS_FILTERS} tone={PALETTE.blue} />
        <div style={{ marginTop: 8 }}>
          <ChipRow value={sys} onChange={setSys} items={SYSTEM_FILTERS} tone={PALETTE.purple} />
        </div>
        <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 10 }}>
          {loading ? "Loading…" : data ? `${data.system} · ${t.leads || 0} leads · ${data.teams?.length || 0} team(s) · ${range}` : ""}
          {data?.note && <span className="hub-badge hub-badge-yellow" style={{ marginLeft: 8 }}>{data.note}</span>}
        </div>
      </div>

      {error && <div className="hub-card"><div className="hub-empty">{error}</div></div>}
      {showCfg && <SystemConfig cfg={cfg} onSaved={() => { loadCfg(); load(); }} />}
      {showCost && <CostEditor cfg={cfg} onSaved={() => { loadCfg(); load(); }} />}

      {!loading && data && (
        <>
          <Grid min={130}>
            {[
              ["Total Leads", t.leads || 0, PALETTE.blue],
              ["Agents", t.agents || 0, PALETTE.cyan],
              ["Calls", t.calls || 0, PALETTE.amber],
              ["Connected", t.connectedCalls || 0, PALETTE.green],
              ["Sales Meetings", t.meetingReached || 0, PALETTE.pink],
              ["Enrolled", t.enrolled || 0, PALETTE.purple],
            ].map(([l, v, c]) => <Hero key={l} label={l} value={v} color={c} />)}
          </Grid>

          <div className="hub-card">
            <div className="hub-card-header"><h3>Key Ratios</h3></div>
            <Grid min={166}>
              <Gauge value={rv("leadQualification")} label="Lead Qualification" color={PALETTE.blue} />
              <Gauge value={rv("firstResponse")} label="First Response" color={PALETTE.cyan} />
              <Gauge value={rv("dialVsConnectivity")} label="Dial vs Connectivity" color={PALETTE.green} sub={`${t.connectedCalls || 0}/${t.calls || 0}`} />
              <Gauge value={rv("salesMeetingToEnrolled")} label="Meeting → Enrolled" color={PALETTE.green} />
              <Gauge value={rv("noResponse")} label="No Response" color={PALETTE.red} />
              <Gauge value={Math.max(0, rv("roi"))} label="ROI" color={rv("roi") >= 0 ? PALETTE.green : PALETTE.red} sub={pct1(rv("roi"))} />
            </Grid>
          </div>

          <ChartCard title="Monthly Trend" numbers={numbers}
            rows={trend.map((m) => [m.month, `${m.leads} leads · ${m.enrolled} enrolled · ${m.connected} connected`])}>
            <ChartCanvas
              type="line"
              height={260}
              data={{
                labels: trend.map((m) => m.month),
                datasets: [
                  { label: "Leads", data: trend.map((m) => m.leads), borderColor: PALETTE.blue, backgroundColor: fillRgba(PALETTE.blue, 0.16), fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5 },
                  { label: "Enrolled", data: trend.map((m) => m.enrolled), borderColor: PALETTE.green, backgroundColor: fillRgba(PALETTE.green, 0.16), fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5 },
                  { label: "Connected", data: trend.map((m) => m.connected), borderColor: PALETTE.amber, backgroundColor: "transparent", fill: false, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2, borderDash: [5, 4] },
                ],
              }}
              options={{
                interaction: { mode: "index", intersect: false },
                scales: {
                  y: { beginAtZero: true, grid: { color: PALETTE.grid, drawBorder: false }, border: { display: false } },
                  x: { grid: { display: false, drawBorder: false }, border: { display: false }, ticks: { color: PALETTE.ink } },
                },
                plugins: { legend: { position: "bottom" }, valueLabels: false },
              }}
            />
          </ChartCard>

          <ChartCard title="Lead Funnel" numbers={numbers}
            rows={[["Leads", t.leads || 0], ["Qualified", t.qualified || 0], ["Sales Meeting", t.meetingReached || 0], ["Enrolled", t.enrolled || 0]]}>
            <ChartCanvas
              type="bar"
              height={250}
              data={{
                labels: ["Leads", "Qualified", "Sales Meeting", "Enrolled"],
                datasets: [{ data: [t.leads || 0, t.qualified || 0, t.meetingReached || 0, t.enrolled || 0], backgroundColor: [PALETTE.blue, PALETTE.cyan, PALETTE.purple, PALETTE.green] }],
              }}
              options={barOpts({ horizontal: true })}
            />
          </ChartCard>

          <div className="hub-card">
            <div className="hub-card-header"><h3>Conversion Rates</h3></div>
            <Grid min={160}>
              <Gauge value={rv("leadToSalesMeeting")} label="Lead → Sales Meeting" color={PALETTE.blue} />
              <Gauge value={rv("salesMeetingToEnrolled")} label="Sales Meeting → Enrolled" color={PALETTE.green} />
              <Gauge value={rv("salesMeetingToLost")} label="Meeting → Not Int./No Resp." color={PALETTE.red} />
              <Gauge value={rv("leadToCalling")} label="Lead → Calling" color={PALETTE.cyan} />
            </Grid>
          </div>

          <Grid min={320}>
            <ChartCard title="Dial vs Connectivity" numbers={numbers}
              rows={[["Connected", t.connectedCalls || 0], ["Not connected", Math.max(0, (t.calls || 0) - (t.connectedCalls || 0))]]}>
              <div style={{ position: "relative", minWidth: 0 }}>
                <ChartCanvas
                  type="doughnut"
                  height={220}
                  data={{
                    labels: ["Connected", "Not connected"],
                    datasets: [{
                      data: [t.connectedCalls || 0, Math.max(0, (t.calls || 0) - (t.connectedCalls || 0))],
                      backgroundColor: [PALETTE.green, PALETTE.track],
                      borderWidth: 2,
                      borderColor: "#fff",
                    }],
                  }}
                  options={{ cutout: "70%", plugins: { legend: { position: "bottom" }, valueLabels: false } }}
                />
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", paddingBottom: 26 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 23, fontWeight: 800, color: PALETTE.ink }}>{pct1(rv("dialVsConnectivity"))}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>connect rate</div>
                  </div>
                </div>
              </div>
            </ChartCard>

            <ChartCard title="Productivity — Time Utilisation" numbers={numbers}
              rows={[["Working Hours (login)", hrs(t.workingSeconds)], ["Talk Time (on calls)", hrs(t.talkSeconds)], ["Utilisation", pct1(rv("workingHoursVsTalktime"))], ["Talk / Enrollment", fmtSec(ratios.talktimeVsEnrollment?.value)]]}>
              <ChartCanvas
                type="bar"
                height={150}
                data={{
                  labels: ["Talk Time", "Idle / other"],
                  datasets: [{
                    label: "Hours",
                    data: [hrs(t.talkSeconds), Math.max(0, hrs(t.workingSeconds) - hrs(t.talkSeconds))],
                    backgroundColor: [PALETTE.amber, PALETTE.track],
                    barThickness: 34,
                  }],
                }}
                options={{
                  indexAxis: "y",
                  layout: { padding: { right: 44, top: 8, bottom: 4 } },
                  scales: {
                    x: { stacked: true, beginAtZero: true, grid: { color: PALETTE.grid, drawBorder: false }, border: { display: false }, ticks: { callback: (v) => `${v}h` } },
                    y: { stacked: true, grid: { display: false, drawBorder: false }, border: { display: false }, ticks: { display: false } },
                  },
                  plugins: {
                    legend: { position: "bottom" },
                    valueLabels: false,
                    tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.formattedValue}h` } },
                  },
                }}
              />
              <div style={subStat}>
                <b>{hrs(t.talkSeconds)}h</b> talk of <b>{hrs(t.workingSeconds)}h</b> logged-in → <b>{pct1(rv("workingHoursVsTalktime"))}</b> utilisation · <b>{fmtSec(ratios.talktimeVsEnrollment?.value)}</b> talk per enrollment
              </div>
            </ChartCard>
          </Grid>

          <ChartCard title="Cost &amp; Revenue" numbers={numbers}
            rows={[["Marketing", money(t.cost?.marketing)], ["Agent", money(t.cost?.agent)], ["Other", money(t.cost?.other)], ["Revenue", money(t.cost?.revenue)]]}>
            <ChartCanvas
              type="bar"
              height={230}
              data={{
                labels: ["Marketing", "Agent", "Other", "Revenue"],
                datasets: [{
                  data: [t.cost?.marketing || 0, t.cost?.agent || 0, t.cost?.other || 0, t.cost?.revenue || 0],
                  backgroundColor: [PALETTE.amber, PALETTE.pink, PALETTE.cyan, PALETTE.green],
                }],
              }}
              options={barOpts({ mny: true })}
            />
            <Grid min={130}>
              <MiniStat label="CAC" value={money(rv("cac"))} />
              <MiniStat label="Cost / Conversion" value={money(rv("costPerConversion"))} />
              <MiniStat label="Lead Cost" value={money(rv("leadCost"))} />
              <MiniStat label="ROI" value={pct1(rv("roi"))} tone={rv("roi") >= 0 ? "#0d9488" : "#dc2626"} />
              <MiniStat label="Revenue Prediction" value={money(ratios.revenuePrediction?.predictedRevenue)} tone="#7c3aed" />
            </Grid>
          </ChartCard>

          {Array.isArray(data.systems) && data.systems.length > 1 && (
            <Grid min={340}>
              <ChartCard title="System Comparison — Key Rates" numbers={numbers}
                rows={data.systems.map((s) => [s.label, `Q ${pct1(s.ratios.leadQualification?.value)} · L→M ${pct1(s.ratios.leadToSalesMeeting?.value)} · M→E ${pct1(s.ratios.salesMeetingToEnrolled?.value)}`])}>
                <ChartCanvas
                  type="radar"
                  height={300}
                  data={{
                    labels: ["Qualification", "Lead→Meeting", "Meeting→Enrolled", "Connect %"],
                    datasets: data.systems.map((s, i) => ({
                      label: s.label,
                      data: [
                        (s.ratios.leadQualification?.value || 0) * 100,
                        (s.ratios.leadToSalesMeeting?.value || 0) * 100,
                        (s.ratios.salesMeetingToEnrolled?.value || 0) * 100,
                        (s.ratios.dialVsConnectivity?.value || 0) * 100,
                      ],
                      borderColor: SERIES[i % SERIES.length],
                      backgroundColor: fillRgba(SERIES[i % SERIES.length], 0.14),
                      borderWidth: 2,
                      pointRadius: 3,
                      pointBackgroundColor: SERIES[i % SERIES.length],
                    })),
                  }}
                  options={{
                    scales: { r: { suggestedMin: 0, suggestedMax: 100, grid: { color: PALETTE.grid }, angleLines: { color: PALETTE.grid }, ticks: { backdropColor: "transparent", callback: (v) => `${v}%`, stepSize: 25 }, pointLabels: { color: PALETTE.ink, font: { size: 11, weight: "600" } } } },
                    plugins: { legend: { position: "bottom" }, valueLabels: false },
                  }}
                />
              </ChartCard>

              <ChartCard title="Lead Volume by System" numbers={numbers}
                rows={data.systems.map((s) => [s.label, s.totals.leads])}>
                <ChartCanvas
                  type="bar"
                  height={Math.max(180, data.systems.length * 48)}
                  data={{
                    labels: data.systems.map((s) => s.label),
                    datasets: [{ data: data.systems.map((s) => s.totals.leads), backgroundColor: data.systems.map((_, i) => SERIES[i % SERIES.length]) }],
                  }}
                  options={barOpts({ horizontal: true })}
                />
              </ChartCard>
            </Grid>
          )}

          <ChartCard title="Lead Source — Conversion" numbers={numbers}
            rows={(data.bySource || []).map((s) => [s.source, `${s.enrolled}/${s.leads} · ${pct1(s.conversion)}`])}>
            {(data.bySource || []).length === 0 ? (
              <div className="hub-empty">No source data.</div>
            ) : (
              <ChartCanvas
                type="bar"
                height={Math.max(180, (data.bySource || []).length * 42)}
                data={{
                  labels: data.bySource.map((s) => s.source),
                  datasets: [{ data: data.bySource.map((s) => s.conversion * 100), backgroundColor: PALETTE.blue }],
                }}
                options={{
                  ...barOpts({ horizontal: true, pct: true, max: 100 }),
                  plugins: {
                    legend: { display: false },
                    valueLabels: { fmt: (v) => `${v.toFixed(1)}%` },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => {
                          const s = data.bySource[ctx.dataIndex];
                          return `${s.enrolled} / ${s.leads} enrolled · ${pct1(s.conversion)}`;
                        },
                      },
                    },
                  },
                }}
              />
            )}
          </ChartCard>
        </>
      )}
    </div>
  );
}

const subStat = { fontSize: 12, color: "#64748b", marginTop: 10 };

function Hero({ label, value, color }) {
  return (
    <div style={{ minWidth: 0, background: "#f8fafc", border: "1px solid #eef0f4", borderRadius: 12, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color }} />
      <div style={{ fontSize: 11.5, color: "#64748b", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 3 }}>{Number(value).toLocaleString()}</div>
    </div>
  );
}
function MiniStat({ label, value, tone = "#0f172a" }) {
  return (
    <div style={{ minWidth: 0, background: "#fff", border: "1px solid #eef0f4", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: tone, marginTop: 2 }}>{value}</div>
    </div>
  );
}

// Plain compact table — NOT .hub-table (that has min-width:700px → scroll).
function NumbersTable({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 12 }}>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} style={{ borderTop: "1px solid #f1f5f9" }}>
            <td style={{ padding: "6px 4px", fontWeight: 600, color: "#475569" }}>{k}</td>
            <td style={{ padding: "6px 4px", textAlign: "right", color: "#0f172a", fontWeight: 700, whiteSpace: "nowrap" }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function ChartCard({ title, children, rows, numbers }) {
  return (
    <div className="hub-card" style={{ minWidth: 0 }}>
      <div className="hub-card-header"><h3>{title}</h3></div>
      {children}
      {numbers && <NumbersTable rows={rows} />}
    </div>
  );
}
function ChipRow({ value, onChange, items, tone }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {items.map((it) => {
        const on = value === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all .15s ease",
              border: `1px solid ${on ? tone : "#e2e8f0"}`,
              background: on ? tone : "#fff",
              color: on ? "#fff" : "#475569",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function SystemConfig({ cfg, onSaved }) {
  const [saving, setSaving] = useState("");
  const save = async (id, patch) => {
    setSaving(id);
    await request.patch({ entity: `sales-dashboard/team/${id}`, jsonData: patch });
    setSaving("");
    onSaved();
  };
  return (
    <div className="hub-card">
      <div className="hub-card-header"><h3><SettingOutlined /> Classify Teams into Systems</h3></div>
      <div className="hub-table-wrapper">
        <table className="hub-table">
          <thead><tr><th>Team</th><th>Business</th><th>Region</th><th>AI / Human</th></tr></thead>
          <tbody>
            {(cfg.teams || []).length === 0 && <tr><td colSpan={4}><div className="hub-empty">No teams yet.</div></td></tr>}
            {(cfg.teams || []).map((tm) => (
              <tr key={tm._id} style={saving === tm._id ? { opacity: 0.5 } : undefined}>
                <td style={{ fontWeight: 600 }}>{tm.name}<div style={{ fontSize: 11, color: "#94a3b8" }}>{(tm.members || []).length} member(s)</div></td>
                {[["businessType", BUSINESS_TYPES], ["region", REGIONS], ["systemType", SYSTEM_TYPES]].map(([key, opts]) => (
                  <td key={key}>
                    <select className="hub-select" value={tm[key] || ""} onChange={(e) => save(tm._id, { [key]: e.target.value })}>
                      <option value="">—</option>
                      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
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
  const nowMonth = new Date().toISOString().slice(0, 7);
  const [f, setF] = useState({
    month: nowMonth, businessType: "", region: "", systemType: "",
    marketingSpend: "", agentCost: "", otherCost: "", revenue: "", avgDealValue: "", notes: "",
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    await request.post({ entity: "sales-dashboard/cost", jsonData: f });
    onSaved();
  };
  const del = async (id) => {
    await request.delete({ entity: `sales-dashboard/cost/${id}` });
    onSaved();
  };
  const Sel = ({ v, on, opts }) => (
    <select className="hub-select" value={v} onChange={on}>
      <option value="">—</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  const L = ({ label, children }) => <div className="hub-form-row"><label>{label}</label>{children}</div>;
  return (
    <div className="hub-card">
      <div className="hub-card-header"><h3><DollarOutlined /> Monthly Costs &amp; Revenue (per System)</h3></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,130px),1fr))", gap: 10 }}>
        <L label="Month"><input type="month" className="hub-input" value={f.month} onChange={set("month")} /></L>
        <L label="Business"><Sel v={f.businessType} on={set("businessType")} opts={BUSINESS_TYPES} /></L>
        <L label="Region"><Sel v={f.region} on={set("region")} opts={REGIONS} /></L>
        <L label="AI/Human"><Sel v={f.systemType} on={set("systemType")} opts={SYSTEM_TYPES} /></L>
        <L label="Marketing Spend"><input className="hub-input" value={f.marketingSpend} onChange={set("marketingSpend")} /></L>
        <L label="Agent Cost"><input className="hub-input" value={f.agentCost} onChange={set("agentCost")} /></L>
        <L label="Other Cost"><input className="hub-input" value={f.otherCost} onChange={set("otherCost")} /></L>
        <L label="Revenue (actual)"><input className="hub-input" value={f.revenue} onChange={set("revenue")} /></L>
        <L label="Avg Deal Value"><input className="hub-input" value={f.avgDealValue} onChange={set("avgDealValue")} /></L>
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" className="hub-btn hub-btn-primary" onClick={save}>Save Cost Row</button>
        <span style={{ fontSize: 11.5, color: "#8c8c8c", marginLeft: 10 }}>Blank Business/Region/AI = whole slice. Ratios sum all rows in the range.</span>
      </div>
      {(cfg.costs || []).length > 0 && (
        <div className="hub-table-wrapper" style={{ marginTop: 12 }}>
          <table className="hub-table">
            <thead><tr><th>Month</th><th>System</th><th>Marketing</th><th>Agent</th><th>Other</th><th>Revenue</th><th>Avg Deal</th><th /></tr></thead>
            <tbody>
              {cfg.costs.map((c) => (
                <tr key={c._id}>
                  <td>{c.month}</td>
                  <td>{[c.businessType, c.region, c.systemType].filter(Boolean).join(" / ") || "All"}</td>
                  <td>{money(c.marketingSpend)}</td><td>{money(c.agentCost)}</td><td>{money(c.otherCost)}</td>
                  <td>{money(c.revenue)}</td><td>{money(c.avgDealValue)}</td>
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
