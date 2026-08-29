import React, { useState } from "react";

const SIZE = 176;
const STROKE = 26;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const GAP_DEGREES = 5; // visual gap between segments, filled by the surface

// Part-to-whole donut with a legend (identity never rides on color alone) and
// a validated categorical palette (fixed hue order — see dataviz skill). With
// no data it renders a single muted ring instead of vanishing, so the chart
// frame is always present and only its content changes once data arrives.
export default function DonutChart({ segments }) {
  const [hoverKey, setHoverKey] = useState(null);
  const total = segments.reduce((sum, s) => sum + (s.value || 0), 0);
  const hasData = total > 0;

  const gapLength = (GAP_DEGREES / 360) * C;
  let offset = 0;
  const arcs = hasData
    ? segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const frac = s.value / total;
          const rawDash = frac * C;
          // Shrink for the gap (rounded caps fill the rest), advance by the
          // full raw length so segments still tile the whole circle.
          const dash = Math.max(rawDash - gapLength, 2);
          const arc = { ...s, dash, gap: C - dash, offset };
          offset += rawDash;
          return arc;
        })
    : [];

  return (
    <div className="viz-root viz-donut-wrapper">
      <div className="viz-donut" style={{ position: "relative", width: SIZE, height: SIZE }}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="Breakdown by outcome">
          {!hasData && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke="var(--viz-muted-fill)"
              strokeWidth={STROKE}
            />
          )}
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={a.color}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${a.dash} ${a.gap}`}
              strokeDashoffset={-a.offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              opacity={hoverKey && hoverKey !== a.key ? 0.35 : 1}
              style={{ transition: "opacity 0.15s ease" }}
              onMouseEnter={() => setHoverKey(a.key)}
              onMouseLeave={() => setHoverKey(null)}
            />
          ))}
        </svg>
        <div className="viz-donut-center">
          <strong>{total.toLocaleString()}</strong>
          <span>{hasData ? "Total" : "No data"}</span>
        </div>
      </div>

      <div className="viz-legend viz-legend-stack">
        {segments.map((s) => (
          <div
            key={s.key}
            className="viz-legend-row"
            onMouseEnter={() => hasData && setHoverKey(s.key)}
            onMouseLeave={() => setHoverKey(null)}
            style={{ opacity: hoverKey && hoverKey !== s.key ? 0.5 : 1 }}
          >
            <span className="viz-legend-dot" style={{ background: s.color }} />
            <span className="viz-legend-label">{s.key}</span>
            <span className="viz-legend-value">{(s.value || 0).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
