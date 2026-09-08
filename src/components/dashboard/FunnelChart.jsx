import React from "react";
import { SERIES } from "./chartTheme";
import { fmtInt } from "./formatters";

/**
 * CSS bar funnel — proportional widths, clickable stages. Backend funnel rows
 * are matched to config stages by key, falling back to positional order.
 */
export default function FunnelChart({ def, rows = [], activeDrill, onStageDrill }) {
  if (!def || !def.stages || !def.stages.length) return null;
  const byKey = {};
  (rows || []).forEach((r) => {
    byKey[r.key] = r;
  });

  const stages = def.stages.map((s, i) => ({
    ...s,
    value: (byKey[s.key] || rows[i] || {}).value || 0,
  }));
  const top = stages[0] ? stages[0].value : 0;

  return (
    <div className="hub-card dash-funnel hub-fade-up">
      <div className="hub-card-header">
        <h3>{def.title || "Funnel"}</h3>
      </div>
      <div className="dash-funnel-body">
        {stages.map((s, i) => {
          const pctOfTop = top ? (s.value / top) * 100 : 0;
          const prev = i ? stages[i - 1].value : s.value;
          const conv = prev ? (s.value / prev) * 100 : 0;
          const color = SERIES[i % SERIES.length];
          const clickable = !!s.drill && !!onStageDrill;
          const active =
            activeDrill && s.drill && activeDrill.field === s.drill.field && String(activeDrill.value) === String(s.drill.value);
          return (
            <button
              key={s.key || i}
              type="button"
              className={`dash-funnel-stage ${clickable ? "clickable" : ""} ${active ? "active" : ""}`}
              onClick={() => clickable && onStageDrill(s.drill)}
            >
              <div className="dash-funnel-meta">
                <span className="dash-funnel-name">{s.label}</span>
                <span className="dash-funnel-val">{fmtInt(s.value)}</span>
              </div>
              <div className="dash-funnel-track">
                <div
                  className="dash-funnel-fill"
                  style={{ width: `${Math.max(pctOfTop, 2)}%`, background: color }}
                />
              </div>
              <div className="dash-funnel-sub">
                {pctOfTop.toFixed(1)}% of top{i > 0 ? ` · ${conv.toFixed(1)}% from previous` : ""}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
