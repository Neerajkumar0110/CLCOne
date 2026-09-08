import React, { useEffect, useState } from "react";
import { SettingOutlined, DollarOutlined, DeleteOutlined } from "@ant-design/icons";
import { request } from "@/request";

const BUSINESS_TYPES = ["B2B", "B2C"];
const REGIONS = ["India", "USA"];
const SYSTEM_TYPES = ["Human", "AI"];
const money = (v) => `₹${Math.round(v || 0).toLocaleString()}`;

// Team → System classification + monthly cost rows. Lifted out of the old
// Sales dashboard so the new analytics shell can still reach the only UI that
// tags teams B2B / B2C (which the ALL | B2B | B2C toggle depends on).
export default function SystemSettings() {
  const [cfg, setCfg] = useState({ teams: [], costs: [] });
  const [tab, setTab] = useState("systems");

  const load = async () => {
    const r = await request.get({ entity: "sales-dashboard/config" });
    if (r?.success) setCfg(r.result);
  };
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="hub-stack" style={{ gap: 14 }}>
      <div className="hub-btn-group">
        <button type="button" className={`hub-btn ${tab === "systems" ? "hub-btn-primary" : ""}`} onClick={() => setTab("systems")}>
          <SettingOutlined /> Team Systems
        </button>
        <button type="button" className={`hub-btn ${tab === "costs" ? "hub-btn-primary" : ""}`} onClick={() => setTab("costs")}>
          <DollarOutlined /> Monthly Costs
        </button>
      </div>
      {tab === "systems" ? <SystemConfig cfg={cfg} onSaved={load} /> : <CostEditor cfg={cfg} onSaved={load} />}
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
    <div className="hub-table-wrapper">
      <table className="hub-table" style={{ minWidth: 0, width: "100%" }}>
        <thead>
          <tr>
            <th>Team</th>
            <th>Business</th>
            <th>Region</th>
            <th>AI / Human</th>
          </tr>
        </thead>
        <tbody>
          {(cfg.teams || []).length === 0 && (
            <tr>
              <td colSpan={4}>
                <div className="hub-empty">No teams yet.</div>
              </td>
            </tr>
          )}
          {(cfg.teams || []).map((tm) => (
            <tr key={tm._id} style={saving === tm._id ? { opacity: 0.5 } : undefined}>
              <td style={{ fontWeight: 600 }}>
                {tm.name}
                <div style={{ fontSize: 11, color: "var(--hub-muted)" }}>{(tm.members || []).length} member(s)</div>
              </td>
              {[
                ["businessType", BUSINESS_TYPES],
                ["region", REGIONS],
                ["systemType", SYSTEM_TYPES],
              ].map(([key, opts]) => (
                <td key={key}>
                  <select className="hub-select" value={tm[key] || ""} onChange={(e) => save(tm._id, { [key]: e.target.value })}>
                    <option value="">—</option>
                    {opts.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CostEditor({ cfg, onSaved }) {
  const nowMonth = new Date().toISOString().slice(0, 7);
  const [f, setF] = useState({
    month: nowMonth,
    businessType: "",
    region: "",
    systemType: "",
    marketingSpend: "",
    agentCost: "",
    otherCost: "",
    revenue: "",
    avgDealValue: "",
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
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
  const L = ({ label, children }) => (
    <div className="hub-form-row">
      <label>{label}</label>
      {children}
    </div>
  );
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,130px),1fr))", gap: 10 }}>
        <L label="Month">
          <input type="month" className="hub-input" value={f.month} onChange={set("month")} />
        </L>
        <L label="Business">
          <Sel v={f.businessType} on={set("businessType")} opts={BUSINESS_TYPES} />
        </L>
        <L label="Region">
          <Sel v={f.region} on={set("region")} opts={REGIONS} />
        </L>
        <L label="AI/Human">
          <Sel v={f.systemType} on={set("systemType")} opts={SYSTEM_TYPES} />
        </L>
        <L label="Marketing Spend">
          <input className="hub-input" value={f.marketingSpend} onChange={set("marketingSpend")} />
        </L>
        <L label="Agent Cost">
          <input className="hub-input" value={f.agentCost} onChange={set("agentCost")} />
        </L>
        <L label="Other Cost">
          <input className="hub-input" value={f.otherCost} onChange={set("otherCost")} />
        </L>
        <L label="Revenue (actual)">
          <input className="hub-input" value={f.revenue} onChange={set("revenue")} />
        </L>
        <L label="Avg Deal Value">
          <input className="hub-input" value={f.avgDealValue} onChange={set("avgDealValue")} />
        </L>
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" className="hub-btn hub-btn-primary" onClick={save}>
          Save Cost Row
        </button>
      </div>
      {(cfg.costs || []).length > 0 && (
        <div className="hub-table-wrapper" style={{ marginTop: 12 }}>
          <table className="hub-table" style={{ minWidth: 0, width: "100%" }}>
            <thead>
              <tr>
                <th>Month</th>
                <th>System</th>
                <th>Marketing</th>
                <th>Agent</th>
                <th>Other</th>
                <th>Revenue</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cfg.costs.map((c) => (
                <tr key={c._id}>
                  <td>{c.month}</td>
                  <td>{[c.businessType, c.region, c.systemType].filter(Boolean).join(" / ") || "All"}</td>
                  <td>{money(c.marketingSpend)}</td>
                  <td>{money(c.agentCost)}</td>
                  <td>{money(c.otherCost)}</td>
                  <td>{money(c.revenue)}</td>
                  <td>
                    <button type="button" className="hub-btn" style={{ padding: "3px 8px", color: "#dc2626" }} onClick={() => del(c._id)}>
                      <DeleteOutlined />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
