import React from "react";
import useCountUp from "./useCountUp";
import Sparkline from "./Sparkline";
import { formatValue, trendMeta, fmtInt } from "./formatters";

const TREND_COLOR = { "trend-good": "var(--hub-green)", "trend-bad": "var(--hub-red)", "trend-flat": "var(--hub-muted)" };

export default function KpiCard({ def, kpi, index = 0, active = false, onDrill }) {
  const value = kpi ? kpi.value : 0;
  const fmt = (kpi && kpi.fmt) || def.fmt || "int";
  const animated = useCountUp(value, { enabled: fmt !== "money" || value < 1e6 });
  const t = trendMeta(kpi ? kpi.deltaPct : 0, def.positiveWhenDown || (kpi && kpi.positiveWhenDown));
  const clickable = !!def.drill && !!onDrill;
  const spark = (kpi && kpi.series) || [];

  const body = (
    <>
      <div className="dash-kpi-label">{def.label}</div>
      <div className="dash-kpi-value">
        {fmt === "int" ? fmtInt(animated) : formatValue(fmt === "money" && value >= 1e6 ? value : animated, fmt)}
      </div>
      <div className="dash-kpi-foot">
        <span className={`dash-kpi-delta ${t.cls}`} style={{ color: TREND_COLOR[t.cls] }}>
          {t.arrow} {Math.abs(kpi ? kpi.deltaPct : 0).toFixed(1)}%
        </span>
        <span className="dash-kpi-prev">vs {formatValue(kpi ? kpi.prev : 0, fmt)}</span>
      </div>
      {spark.length > 1 && (
        <div className="dash-kpi-spark">
          <Sparkline points={spark} color={TREND_COLOR[t.cls]} height={30} />
        </div>
      )}
    </>
  );

  const cls = `dash-kpi hub-fade-up ${active ? "dash-kpi-active" : ""} ${clickable ? "dash-kpi-click" : ""}`;
  const style = { "--d": `${index * 40}ms` };

  if (clickable) {
    return (
      <button type="button" className={cls} style={style} onClick={() => onDrill(def.drill)}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}
