import React from "react";
import { fmtPct, fmtSec, fmtMoney } from "./formatters";

function fmtRatio(val, fmt) {
  switch (fmt) {
    case "sec":
      return fmtSec(val);
    case "days":
      return `${Math.round(val)}d`;
    case "num":
      return (Math.round(val * 100) / 100).toLocaleString();
    case "x":
      return `${(val || 0).toFixed(2)}×`;
    case "money":
      return fmtMoney(val);
    default:
      return fmtPct((val || 0) * 100);
  }
}

// Compact ratio chips. Backend sends { key, label, value, numerator,
// denominator, prev, positiveWhenDown }. Most ratios are 0-1 fractions shown
// as %; a few (cycle days, handle-time seconds, calls-per-lead) carry a `fmt`
// on the config def.
export default function RatioStrip({ defs = [], ratios = [], loading }) {
  const byKey = {};
  (ratios || []).forEach((r) => {
    byKey[r.key] = r;
  });
  if (!defs.length) return null;

  return (
    <div className="hub-card dash-ratios">
      <div className="hub-card-header">
        <h3>Key Ratios</h3>
      </div>
      <div className="dash-ratio-row">
        {defs.map((def) => {
          const r = byKey[def.key];
          const val = r ? r.value : 0;
          const isPct = !def.fmt || def.fmt === "pct";
          const delta = r && r.prev != null ? (isPct ? (val - r.prev) * 100 : val - r.prev) : null;
          const positiveWhenDown = def.positiveWhenDown || (r && r.positiveWhenDown);
          const good = delta == null ? null : positiveWhenDown ? delta <= 0 : delta >= 0;
          return (
            <div key={def.key} className="dash-ratio">
              <div className="dash-ratio-label">{def.label}</div>
              <div className="dash-ratio-value">{loading && !r ? "…" : fmtRatio(val, def.fmt)}</div>
              {r && r.denominator ? (
                <div className="dash-ratio-sub">
                  {Math.round(r.numerator)} / {Math.round(r.denominator)}
                </div>
              ) : (
                <div className="dash-ratio-sub" />
              )}
              {delta != null && Math.abs(delta) >= 0.1 && (
                <div className="dash-ratio-delta" style={{ color: good ? "var(--hub-green)" : "var(--hub-red)" }}>
                  {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
                  {isPct ? " pp" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
