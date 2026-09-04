import React, { useEffect, useMemo, useState, useCallback } from "react";
import { request } from "@/request";
import {
  AppstoreOutlined, ReloadOutlined, TableOutlined, EditOutlined,
  DeleteOutlined, RightOutlined, DownOutlined, FolderOpenOutlined,
} from "@ant-design/icons";
import ChartCanvas, { Gauge, PALETTE, fillRgba } from "@/pages/SalesDashboard/ChartCanvas";

const BUSINESS_FILTERS = [
  { key: "all", label: "All Business" },
  { key: "b2b", label: "B2B", businessType: "B2B" },
  { key: "b2c", label: "B2C", businessType: "B2C" },
];
const SYSTEM_FILTERS = [
  { key: "combined", label: "Combined System" },
  { key: "human", label: "Human System", systemType: "Human" },
  { key: "ai", label: "AI System", systemType: "AI" },
];
const REGION_FILTERS = [
  { key: "all", label: "All Regions" },
  { key: "India", label: "India", region: "India" },
  { key: "USA", label: "USA", region: "USA" },
];
const RANGES = { "90D": 90, "6M": 182, "1Y": 365 };

const pct1 = (v) => `${((v || 0) * 100).toFixed(1)}%`;
const money = (v) => `₹${Math.round(v || 0).toLocaleString()}`;
const mult = (v) => `${(v || 0).toFixed(2)}×`;
const num = (v) => Math.round((v || 0) * 100) / 100;
const fmtKind = (kind, v) =>
  kind === "percent" ? pct1(v) : kind === "currency" ? money(v) : kind === "ratio" ? mult(v) : `${num(v).toLocaleString()}`;

function Grid({ min = 190, children }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 14 }}>{children}</div>;
}
function barOpts({ horizontal = false, pct = false, mny = false } = {}) {
  const v = horizontal ? "x" : "y", c = horizontal ? "y" : "x";
  return {
    indexAxis: horizontal ? "y" : "x",
    layout: { padding: { right: horizontal ? 52 : 10, top: 20, left: 2, bottom: 2 } },
    scales: {
      [v]: { beginAtZero: true, grid: { color: PALETTE.grid, drawBorder: false }, border: { display: false }, ticks: { callback: (x) => (pct ? `${x}%` : mny ? money(x) : x) } },
      [c]: { grid: { display: false, drawBorder: false }, border: { display: false }, ticks: { color: PALETTE.ink, font: { weight: "600" } } },
    },
    plugins: { legend: { display: false }, valueLabels: { fmt: (x) => (pct ? `${x.toFixed(1)}%` : mny ? money(x) : num(x)) } },
    borderRadius: 8, borderSkipped: false, barPercentage: 0.62, categoryPercentage: 0.7,
  };
}

// ── tree nav ──────────────────────────────────────────────────────────
function TreeNode({ node, depth, activeKey, onPick, openMap, toggle }) {
  const isLeaf = !node.children;
  if (isLeaf) {
    const on = node.key === activeKey;
    return (
      <button type="button" onClick={() => onPick(node)}
        style={{
          display: "block", width: "100%", textAlign: "left", cursor: "pointer",
          padding: "6px 10px", paddingLeft: 12 + depth * 12, fontSize: 12.5,
          border: "none", borderRadius: 8, marginBottom: 1,
          background: on ? PALETTE.blue : "transparent", color: on ? "#fff" : "#334155",
          fontWeight: on ? 700 : 500,
        }}>
        {node.label}
      </button>
    );
  }
  const open = openMap[node.key] ?? depth === 0;
  return (
    <div>
      <button type="button" onClick={() => toggle(node.key)}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
          cursor: "pointer", padding: "7px 10px", paddingLeft: 8 + depth * 12,
          border: "none", background: "transparent", borderRadius: 8,
          fontSize: depth === 0 ? 12.5 : 12, fontWeight: depth === 0 ? 800 : 600,
          color: depth === 0 ? "#0f172a" : "#475569", textTransform: depth === 0 ? "uppercase" : "none",
          letterSpacing: depth === 0 ? 0.3 : 0,
        }}>
        {open ? <DownOutlined style={{ fontSize: 9 }} /> : <RightOutlined style={{ fontSize: 9 }} />}
        {node.group ? <FolderOpenOutlined style={{ fontSize: 11, opacity: 0.6 }} /> : null}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
      </button>
      {open && node.children.map((c) => (
        <TreeNode key={c.key} node={c} depth={depth + 1} activeKey={activeKey} onPick={onPick} openMap={openMap} toggle={toggle} />
      ))}
    </div>
  );
}

export default function MarketingHub() {
  const [tree, setTree] = useState([]);
  const [templates, setTemplates] = useState({});
  const [openMap, setOpenMap] = useState({});
  const [leaf, setLeaf] = useState(null);

  const [biz, setBiz] = useState("all");
  const [sys, setSys] = useState("combined");
  const [reg, setReg] = useState("all");
  const [range, setRange] = useState("6M");
  const [numbers, setNumbers] = useState(false);
  const [showEntry, setShowEntry] = useState(false);

  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggle = (k) => setOpenMap((m) => ({ ...m, [k]: !(m[k] ?? false) }));

  useEffect(() => {
    (async () => {
      const r = await request.get({ entity: "marketing-hub/tree" });
      if (r?.success) {
        setTree(r.result.tree || []);
        setTemplates(r.result.templates || {});
        // auto-open first section + select first leaf
        const first = r.result.tree?.[0];
        setOpenMap({ [first?.key]: true });
        const firstLeaf = findFirstLeaf(first);
        if (firstLeaf) setLeaf(firstLeaf);
      }
    })();
  }, []);

  const query = useMemo(() => {
    const b = BUSINESS_FILTERS.find((x) => x.key === biz) || {};
    const s = SYSTEM_FILTERS.find((x) => x.key === sys) || {};
    const rg = REGION_FILTERS.find((x) => x.key === reg) || {};
    const to = new Date();
    const from = new Date(to.getTime() - RANGES[range] * 86400000);
    const q = { from: from.toISOString(), to: to.toISOString() };
    if (b.businessType) q.businessType = b.businessType;
    if (s.systemType) q.systemType = s.systemType;
    if (rg.region) q.region = rg.region;
    return q;
  }, [biz, sys, reg, range]);

  const load = useCallback(async () => {
    if (!leaf) return;
    setLoading(true); setError("");
    const qs = new URLSearchParams(query).toString();
    const r = await request.get({ entity: `marketing-hub/dashboard/${leaf.key}?${qs}` });
    if (r?.success) setData(r.result); else setError(r?.message || "Failed to load.");
    if (leaf.source === "manual" || (!leaf.source && !leaf.children)) {
      const mr = await request.get({ entity: `marketing-hub/metrics/${leaf.key}` });
      if (mr?.success) setRows(mr.result || []);
    } else setRows([]);
    setLoading(false);
  }, [leaf, query]);

  useEffect(() => { load(); }, [load]);

  const pick = (n) => { setLeaf(n); setShowEntry(false); setData(null); };

  return (
    <div className="hub-stack" style={{ minWidth: 0 }}>
      <div className="hub-card">
        <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 10 }}>
          <h3><AppstoreOutlined /> Marketing Analytics Hub</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <select className="hub-select" style={{ maxWidth: 90 }} value={range} onChange={(e) => setRange(e.target.value)}>
              {Object.keys(RANGES).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button type="button" className="hub-btn" onClick={load}><ReloadOutlined /> Refresh</button>
            <button type="button" className={`hub-btn ${numbers ? "hub-btn-primary" : ""}`} onClick={() => setNumbers((v) => !v)}><TableOutlined /> Numbers</button>
            {data?.source === "manual" && (
              <button type="button" className={`hub-btn ${showEntry ? "hub-btn-primary" : ""}`} onClick={() => setShowEntry((v) => !v)}><EditOutlined /> Enter Metrics</button>
            )}
          </div>
        </div>
        <ChipRow value={biz} onChange={setBiz} items={BUSINESS_FILTERS} tone={PALETTE.blue} />
        <div style={{ marginTop: 8 }}><ChipRow value={sys} onChange={setSys} items={SYSTEM_FILTERS} tone={PALETTE.purple} /></div>
        <div style={{ marginTop: 8 }}><ChipRow value={reg} onChange={setReg} items={REGION_FILTERS} tone={PALETTE.cyan} /></div>
        <div style={{ fontSize: 12, color: "#8c8c8c", marginTop: 10 }}>
          {leaf ? <><strong>{leaf.label}</strong> · {loading ? "loading…" : sourceBadge(data?.source)}</> : "Pick a dashboard from the left."}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 260px) minmax(0, 1fr)", gap: 14, alignItems: "start" }} className="mkt-hub-grid">
        {/* nav */}
        <div className="hub-card" style={{ position: "sticky", top: 8, maxHeight: "78vh", overflowY: "auto", padding: 10 }}>
          {tree.length === 0 ? <div className="hub-empty">Loading…</div> :
            tree.map((n) => <TreeNode key={n.key} node={n} depth={0} activeKey={leaf?.key} onPick={pick} openMap={openMap} toggle={toggle} />)}
        </div>

        {/* body */}
        <div className="hub-stack" style={{ minWidth: 0 }}>
          {error && <div className="hub-card"><div className="hub-empty">{error}</div></div>}
          {showEntry && data?.source === "manual" && (
            <MetricEntry leaf={leaf} inputs={data.inputs || []} rows={rows} defaults={query} onSaved={load} />
          )}
          {!loading && data && data.source === "manual" && <ManualView data={data} numbers={numbers} />}
          {!loading && data && data.source === "leads" && <LeadsView data={data} numbers={numbers} />}
          {!loading && data && data.source === "campaigns" && <CampaignsView data={data} numbers={numbers} />}
          {loading && <div className="hub-card"><div className="hub-empty">Loading…</div></div>}
        </div>
      </div>
    </div>
  );
}

// ── manual dashboard view ─────────────────────────────────────────────
function ManualView({ data, numbers }) {
  const ratios = data.ratios || [];
  const totals = data.totals || {};
  const inputs = data.inputs || [];
  const trend = data.trend || [];
  const pctRatios = ratios.filter((r) => r.kind === "percent");
  const otherRatios = ratios.filter((r) => r.kind !== "percent");
  const trendKeys = inputs.slice(0, 3).map((i) => i.key);
  const toneFor = (i) => [PALETTE.blue, PALETTE.green, PALETTE.amber, PALETTE.purple, PALETTE.cyan, PALETTE.pink][i % 6];

  return (
    <>
      {data.rowCount === 0 && (
        <div className="hub-card"><div className="hub-empty">
          No metrics entered for this slice yet. Click <strong>Enter Metrics</strong> above to add a month.
        </div></div>
      )}

      <Grid min={165}>
        {inputs.map((i, idx) => <Mini key={i.key} label={i.label} value={fmtKind(i.kind, totals[i.key])} tone={toneFor(idx)} />)}
      </Grid>

      {otherRatios.length > 0 && (
        <Grid min={165}>
          {otherRatios.map((r, idx) => <Mini key={r.key} label={r.label} value={fmtKind(r.kind, r.value)} tone={toneFor(idx + 2)} />)}
        </Grid>
      )}

      {pctRatios.length > 0 && (
        <div className="hub-card">
          <div className="hub-card-header"><h3>Conversion &amp; Rate Ratios</h3></div>
          <Grid min={160}>
            {pctRatios.map((r, idx) => (
              <Gauge key={r.key} value={r.value} label={r.label}
                color={[PALETTE.blue, PALETTE.green, PALETTE.amber, PALETTE.purple, PALETTE.cyan][idx % 5]} />
            ))}
          </Grid>
        </div>
      )}

      {trend.length > 0 && trendKeys.length > 0 && (
        <Card title="Monthly Trend" numbers={numbers}
          rows={trend.map((m) => [m.month, trendKeys.map((k) => `${k}: ${num(m[k])}`).join(" · ")])}>
          <ChartCanvas type="line" height={250}
            data={{
              labels: trend.map((m) => m.month),
              datasets: trendKeys.map((k, i) => ({
                label: (inputs.find((x) => x.key === k) || {}).label || k,
                data: trend.map((m) => m[k] || 0),
                borderColor: toneFor(i), backgroundColor: fillRgba(toneFor(i), 0.14),
                fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5,
              })),
            }}
            options={{ interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, grid: { color: PALETTE.grid, drawBorder: false }, border: { display: false } }, x: { grid: { display: false, drawBorder: false }, border: { display: false } } }, plugins: { legend: { position: "bottom" }, valueLabels: false } }}
          />
        </Card>
      )}
    </>
  );
}

// ── leads dashboard view ──────────────────────────────────────────────
function LeadsView({ data, numbers }) {
  const t = data.totals || {};
  const ratios = data.ratios || [];
  const trend = data.trend || [];
  const bySource = data.bySource || [];
  return (
    <>
      <Grid min={150}>
        <Mini label="Leads" value={num(t.leads).toLocaleString()} tone={PALETTE.blue} />
        <Mini label="Qualified" value={num(t.qualified).toLocaleString()} tone={PALETTE.cyan} />
        <Mini label="Sales Meetings" value={num(t.meetingReached).toLocaleString()} tone={PALETTE.amber} />
        <Mini label="Enrolled" value={num(t.enrolled).toLocaleString()} tone={PALETTE.green} />
        <Mini label="Dead / Lost" value={num(t.dead).toLocaleString()} tone={PALETTE.red} />
      </Grid>

      <div className="hub-card">
        <div className="hub-card-header"><h3>Funnel Ratios</h3></div>
        <Grid min={160}>
          {ratios.map((r, idx) => (
            <Gauge key={r.key} value={r.value} label={r.label}
              color={[PALETTE.blue, PALETTE.green, PALETTE.red, PALETTE.amber, PALETTE.purple, PALETTE.cyan, PALETTE.pink][idx % 7]} />
          ))}
        </Grid>
      </div>

      <Card title="Monthly Trend" numbers={numbers}
        rows={trend.map((m) => [m.month, `${m.leads} leads · ${m.qualified} qualified · ${m.enrolled} enrolled`])}>
        <ChartCanvas type="line" height={250}
          data={{
            labels: trend.map((m) => m.month),
            datasets: [
              { label: "Leads", data: trend.map((m) => m.leads), borderColor: PALETTE.blue, backgroundColor: fillRgba(PALETTE.blue, 0.16), fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5 },
              { label: "Qualified", data: trend.map((m) => m.qualified), borderColor: PALETTE.cyan, backgroundColor: fillRgba(PALETTE.cyan, 0.12), fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5 },
              { label: "Enrolled", data: trend.map((m) => m.enrolled), borderColor: PALETTE.green, backgroundColor: fillRgba(PALETTE.green, 0.16), fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5 },
            ],
          }}
          options={{ interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, grid: { color: PALETTE.grid, drawBorder: false }, border: { display: false } }, x: { grid: { display: false, drawBorder: false }, border: { display: false } } }, plugins: { legend: { position: "bottom" }, valueLabels: false } }}
        />
      </Card>

      <Card title="Lead Source — Volume &amp; Conversion" numbers={numbers}
        rows={bySource.map((s) => [s.source, `${s.leads} leads · ${s.enrolled} enrolled · ${pct1(s.conversion)}`])}>
        {bySource.length === 0 ? <div className="hub-empty">No source data.</div> : (
          <ChartCanvas type="bar" height={Math.max(200, bySource.length * 40)}
            data={{ labels: bySource.map((s) => s.source), datasets: [{ label: "Leads", data: bySource.map((s) => s.leads), backgroundColor: PALETTE.blue }] }}
            options={{ ...barOpts({ horizontal: true }), plugins: { legend: { display: false }, valueLabels: { fmt: (v) => num(v) }, tooltip: { callbacks: { label: (c) => { const s = bySource[c.dataIndex]; return `${s.leads} leads · ${s.enrolled} enrolled · ${pct1(s.conversion)} conv`; } } } } }}
          />
        )}
      </Card>
    </>
  );
}

// ── campaigns dashboard view ──────────────────────────────────────────
function CampaignsView({ data, numbers }) {
  const t = data.totals || {};
  const ratios = data.ratios || [];
  const byType = data.byType || [];
  const trend = data.trend || [];
  return (
    <>
      <Grid min={150}>
        <Mini label="Campaigns" value={num(t.campaigns)} tone={PALETTE.blue} />
        <Mini label="Active" value={num(t.active)} tone={PALETTE.green} />
        <Mini label="Budget" value={money(t.budget)} tone={PALETTE.slate} />
        <Mini label="Spend" value={money(t.spend)} tone={PALETTE.amber} />
        <Mini label="Leads" value={num(t.leads)} tone={PALETTE.cyan} />
        <Mini label="Revenue" value={money(t.revenue)} tone={PALETTE.green} />
      </Grid>

      <Grid min={165}>
        {ratios.map((r, idx) => <Mini key={r.key} label={r.label} value={fmtKind(r.kind, r.value)}
          tone={[PALETTE.blue, PALETTE.purple, PALETTE.cyan, PALETTE.green, r.value >= 0 ? "#0d9488" : "#dc2626", PALETTE.amber][idx % 6]} />)}
      </Grid>

      <Card title="Spend &amp; Leads by Campaign Type" numbers={numbers}
        rows={byType.map((x) => [x.type, `${x.count} camp · spend ${money(x.spend)} · ${x.leads} leads · ${x.conversions} conv`])}>
        {byType.length === 0 ? <div className="hub-empty">No campaigns in range.</div> : (
          <ChartCanvas type="bar" height={Math.max(200, byType.length * 46)}
            data={{
              labels: byType.map((x) => x.type),
              datasets: [
                { label: "Spend", data: byType.map((x) => x.spend), backgroundColor: PALETTE.amber },
                { label: "Revenue", data: byType.map((x) => x.revenue), backgroundColor: PALETTE.green },
              ],
            }}
            options={{ ...barOpts({ horizontal: true, mny: true }), plugins: { legend: { position: "bottom" }, valueLabels: false } }}
          />
        )}
      </Card>

      <Card title="Monthly Trend" numbers={numbers}
        rows={trend.map((m) => [m.month, `spend ${money(m.spend)} · ${m.leads} leads · ${m.conversions} conv`])}>
        <ChartCanvas type="line" height={240}
          data={{
            labels: trend.map((m) => m.month),
            datasets: [
              { label: "Spend", data: trend.map((m) => m.spend), borderColor: PALETTE.amber, backgroundColor: fillRgba(PALETTE.amber, 0.14), fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5, yAxisID: "y" },
              { label: "Leads", data: trend.map((m) => m.leads), borderColor: PALETTE.blue, backgroundColor: fillRgba(PALETTE.blue, 0.14), fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2.5, yAxisID: "y" },
            ],
          }}
          options={{ interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, grid: { color: PALETTE.grid, drawBorder: false }, border: { display: false } }, x: { grid: { display: false, drawBorder: false }, border: { display: false } } }, plugins: { legend: { position: "bottom" }, valueLabels: false } }}
        />
      </Card>
    </>
  );
}

// ── manual metric entry ───────────────────────────────────────────────
function MetricEntry({ leaf, inputs, rows, defaults, onSaved }) {
  const blank = () => {
    const v = {};
    inputs.forEach((i) => { v[i.key] = ""; });
    return v;
  };
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [region, setRegion] = useState(defaults.region || "");
  const [businessType, setBusinessType] = useState(defaults.businessType || "");
  const [systemType, setSystemType] = useState(defaults.systemType || "");
  const [vals, setVals] = useState(blank());
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    setSaving(true);
    await request.post({
      entity: `marketing-hub/metrics/${leaf.key}`,
      jsonData: { month, region: region || null, businessType: businessType || null, systemType: systemType || null, values: vals },
    });
    setSaving(false);
    setVals(blank());
    onSaved();
  };
  const del = async (id) => { await request.delete({ entity: `marketing-hub/metrics/${leaf.key}/${id}` }); onSaved(); };
  const L = ({ label, children }) => <div className="hub-form-row"><label>{label}</label>{children}</div>;

  return (
    <div className="hub-card">
      <div className="hub-card-header"><h3><EditOutlined /> Enter Monthly Metrics — {leaf.label}</h3></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,140px),1fr))", gap: 10 }}>
        <L label="Month"><input type="month" className="hub-input" value={month} onChange={(e) => setMonth(e.target.value)} /></L>
        <L label="Region">
          <select className="hub-select" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All</option><option>India</option><option>USA</option>
          </select>
        </L>
        <L label="Business">
          <select className="hub-select" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
            <option value="">All</option><option>B2B</option><option>B2C</option>
          </select>
        </L>
        <L label="AI / Human">
          <select className="hub-select" value={systemType} onChange={(e) => setSystemType(e.target.value)}>
            <option value="">All</option><option>Human</option><option>AI</option>
          </select>
        </L>
        {inputs.map((i) => (
          <L key={i.key} label={i.label}>
            <input className="hub-input" inputMode="decimal" value={vals[i.key]}
              onChange={(e) => setVals((s) => ({ ...s, [i.key]: e.target.value }))} />
          </L>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" className="hub-btn hub-btn-primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save Month"}
        </button>
        <span style={{ fontSize: 11.5, color: "#8c8c8c", marginLeft: 10 }}>
          Ratios below are derived automatically from these inputs.
        </span>
      </div>

      {rows.length > 0 && (
        <div className="hub-table-wrapper" style={{ marginTop: 12 }}>
          <table className="hub-table">
            <thead>
              <tr>
                <th>Month</th><th>Slice</th>
                {inputs.map((i) => <th key={i.key}>{i.label}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id}>
                  <td>{r.month}</td>
                  <td>{[r.businessType, r.region, r.systemType].filter(Boolean).join(" / ") || "All"}</td>
                  {inputs.map((i) => <td key={i.key}>{num(r.values?.[i.key])}</td>)}
                  <td><button type="button" className="hub-btn" style={{ padding: "3px 8px", color: "#dc2626" }} onClick={() => del(r._id)}><DeleteOutlined /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── small shared bits ─────────────────────────────────────────────────
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
      <tbody>{rows.map(([k, v], i) => (
        <tr key={`${k}-${i}`} style={{ borderTop: "1px solid #f1f5f9" }}>
          <td style={{ padding: "6px 4px", fontWeight: 600, color: "#475569" }}>{k}</td>
          <td style={{ padding: "6px 4px", textAlign: "right", color: "#0f172a", fontWeight: 700 }}>{v}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}
function Card({ title, children, rows, numbers }) {
  return (
    <div className="hub-card" style={{ minWidth: 0 }}>
      <div className="hub-card-header"><h3 dangerouslySetInnerHTML={{ __html: title }} /></div>
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
          <button key={it.key} type="button" onClick={() => onChange(it.key)}
            style={{ padding: "5px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer", border: `1px solid ${on ? tone : "#e2e8f0"}`, background: on ? tone : "#fff", color: on ? "#fff" : "#475569" }}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
function sourceBadge(src) {
  if (src === "leads") return "live CRM lead data";
  if (src === "campaigns") return "live campaign data";
  if (src === "manual") return "manual monthly metrics";
  return "—";
}
function findFirstLeaf(node) {
  if (!node) return null;
  if (!node.children) return node;
  for (const c of node.children) {
    const f = findFirstLeaf(c);
    if (f) return f;
  }
  return null;
}
