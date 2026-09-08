import React, { useEffect, useMemo, useState, useCallback } from "react";
import { request } from "@/request";
import {
  AppstoreOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
  RightOutlined, DownOutlined, FolderOpenOutlined, RadarChartOutlined, SwapOutlined,
} from "@ant-design/icons";
import { PALETTE } from "@/pages/SalesDashboard/ChartCanvas";
import { PRESETS, rangeForPreset, quickRange, presetForRange } from "@/components/dashboard/dateRanges";
import LeafDashboard from "./LeafDashboard";
import ComparePanel from "./ComparePanel";
import "./marketingHub.css";

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
const QUICK = [15, 30, 60, 90, 180];
const num = (v) => Math.round((v || 0) * 100) / 100;

// Pinned virtual nodes at the top of the tree.
const MASTER_NODE = { key: "__master__", label: "Marketing Master", virtual: "master" };
const COMPARE_NODE = { key: "__compare__", label: "Comparison", virtual: "compare" };

function TreeNode({ node, depth, activeKey, onPick, openMap, toggle }) {
  const isLeaf = !node.children;
  if (isLeaf) {
    const on = node.key === activeKey;
    return (
      <button
        type="button"
        onClick={() => onPick(node)}
        className={`mkt-tree-leaf ${on ? "active" : ""}`}
        style={{ paddingLeft: 12 + depth * 12 }}
      >
        {node.virtual === "master" && <RadarChartOutlined style={{ marginRight: 6 }} />}
        {node.virtual === "compare" && <SwapOutlined style={{ marginRight: 6 }} />}
        {node.label}
      </button>
    );
  }
  const open = openMap[node.key] ?? depth === 0;
  return (
    <div>
      <button
        type="button"
        onClick={() => toggle(node.key)}
        className={`mkt-tree-folder depth-${depth}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
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
  const [openMap, setOpenMap] = useState({});
  const [leaf, setLeaf] = useState(MASTER_NODE);

  const [biz, setBiz] = useState("all");
  const [sys, setSys] = useState("combined");
  const [reg, setReg] = useState("all");
  const [presetKey, setPresetKey] = useState("30d");
  const [range, setRange] = useState(() => rangeForPreset("30d"));
  const [showEntry, setShowEntry] = useState(false);

  const [data, setData] = useState(null);
  const [metricRows, setMetricRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggle = (k) => setOpenMap((m) => ({ ...m, [k]: !(m[k] ?? false) }));

  useEffect(() => {
    (async () => {
      const r = await request.get({ entity: "marketing-hub/tree" });
      if (r?.success) {
        setTree(r.result.tree || []);
        const first = r.result.tree?.[0];
        if (first) setOpenMap({ [first.key]: true });
      }
    })();
  }, []);

  const query = useMemo(() => {
    const b = BUSINESS_FILTERS.find((x) => x.key === biz) || {};
    const s = SYSTEM_FILTERS.find((x) => x.key === sys) || {};
    const rg = REGION_FILTERS.find((x) => x.key === reg) || {};
    const q = { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() };
    if (b.businessType) q.businessType = b.businessType;
    if (s.systemType) q.systemType = s.systemType;
    if (rg.region) q.region = rg.region;
    return q;
  }, [biz, sys, reg, range]);

  const isVirtual = !!leaf?.virtual;
  const isManual = data?.source === "manual";

  const load = useCallback(async () => {
    if (!leaf || leaf.virtual === "compare") return;
    setLoading(true);
    setError("");
    const qs = new URLSearchParams(query).toString();
    const path = leaf.virtual === "master" ? `marketing-hub/master?${qs}` : `marketing-hub/dashboard/${leaf.key}?${qs}`;
    const r = await request.get({ entity: path });
    if (r?.success) setData(r.result);
    else setError(r?.message || "Failed to load.");
    if (r?.success && r.result.source === "manual") {
      const mr = await request.get({ entity: `marketing-hub/metrics/${leaf.key}` });
      if (mr?.success) setMetricRows(mr.result || []);
    } else setMetricRows([]);
    setLoading(false);
  }, [leaf, query]);

  useEffect(() => {
    load();
  }, [load]);

  const pick = (n) => {
    setLeaf(n);
    setShowEntry(false);
    if (n.virtual !== "compare") setData(null);
  };
  const setPreset = (key) => {
    setPresetKey(key);
    if (key !== "custom") setRange(rangeForPreset(key));
  };
  const setQuick = (days) => {
    setRange(quickRange(days));
    setPresetKey(presetForRange(quickRange(days).from, quickRange(days).to));
  };

  const title = leaf?.virtual === "master" ? "Marketing Intelligence"
    : leaf?.virtual === "compare" ? "Comparison"
    : data?.label || leaf?.label || "";

  return (
    <div className="hub-stack" style={{ minWidth: 0 }}>
      <div className="hub-card">
        <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 10 }}>
          <h3><AppstoreOutlined /> {title}</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <select className="hub-select" style={{ maxWidth: 150 }} value={presetKey} onChange={(e) => setPreset(e.target.value)}>
              {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <div className="hub-pill-filter">
              {QUICK.map((d) => (
                <button key={d} type="button" className={`hub-pill-btn ${presetKey === `${d}d` ? "active" : ""}`} onClick={() => setQuick(d)}>
                  {d}D
                </button>
              ))}
            </div>
            <button type="button" className="hub-btn" onClick={load}><ReloadOutlined spin={loading} /> Refresh</button>
            {isManual && (
              <button type="button" className={`hub-btn ${showEntry ? "hub-btn-primary" : ""}`} onClick={() => setShowEntry((v) => !v)}>
                <EditOutlined /> Enter Metrics
              </button>
            )}
          </div>
        </div>
        <ChipRow value={biz} onChange={setBiz} items={BUSINESS_FILTERS} tone={PALETTE.blue} />
        <div style={{ marginTop: 8 }}><ChipRow value={sys} onChange={setSys} items={SYSTEM_FILTERS} tone={PALETTE.purple} /></div>
        <div style={{ marginTop: 8 }}><ChipRow value={reg} onChange={setReg} items={REGION_FILTERS} tone={PALETTE.cyan} /></div>
      </div>

      <div className="mkt-hub-grid">
        <div className="hub-card mkt-hub-nav">
          <TreeNode node={MASTER_NODE} depth={0} activeKey={leaf?.key} onPick={pick} openMap={openMap} toggle={toggle} />
          <TreeNode node={COMPARE_NODE} depth={0} activeKey={leaf?.key} onPick={pick} openMap={openMap} toggle={toggle} />
          <div className="mkt-tree-sep" />
          {tree.length === 0 ? (
            <div className="hub-empty">Loading…</div>
          ) : (
            tree.map((n) => <TreeNode key={n.key} node={n} depth={0} activeKey={leaf?.key} onPick={pick} openMap={openMap} toggle={toggle} />)
          )}
        </div>

        <div className="hub-stack" style={{ minWidth: 0 }}>
          {error && <div className="hub-card"><div className="hub-notice"><span>{error}</span><button type="button" className="hub-btn hub-btn-primary" style={{ marginLeft: 12 }} onClick={load}>Retry</button></div></div>}

          {leaf?.virtual === "compare" ? (
            <ComparePanel compareKey="master" query={query} />
          ) : (
            <>
              {showEntry && isManual && (
                <MetricEntry leaf={leaf} inputs={data.inputs || []} rows={metricRows} defaults={query} onSaved={load} />
              )}
              <LeafDashboard leafKey={leaf?.virtual === "master" ? "master" : leaf?.key} data={data} loading={loading} query={query} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── manual metric entry (unchanged behaviour) ─────────────────────────
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
            <input className="hub-input" inputMode="decimal" value={vals[i.key]} onChange={(e) => setVals((s) => ({ ...s, [i.key]: e.target.value }))} />
          </L>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" className="hub-btn hub-btn-primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save Month"}
        </button>
        <span style={{ fontSize: 11.5, color: "var(--hub-muted)", marginLeft: 10 }}>Ratios update automatically from these inputs.</span>
      </div>
      {rows.length > 0 && (
        <div className="hub-table-wrapper" style={{ marginTop: 12 }}>
          <table className="hub-table" style={{ minWidth: 0, width: "100%" }}>
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
              padding: "5px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${on ? tone : "var(--hub-border)"}`,
              background: on ? tone : "var(--hub-surface)",
              color: on ? "#fff" : "var(--hub-text-soft)",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
