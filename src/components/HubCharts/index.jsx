import React, { useMemo } from "react";

function getNiceMax(peak) {
  if (peak <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(peak)));
  const step = magnitude / 2 || 1;
  return Math.ceil(peak / step) * step;
}

/**
 * data: [{ label, values: [{ value, color, tooltip }] }]
 */
export function HubBarChart({ data }) {
  const peak = Math.max(
    ...data.map((d) => Math.max(...d.values.map((v) => v.value)))
  );
  const max = getNiceMax(peak * 1.15);
  const gridLines = [max, max * 0.75, max * 0.5, max * 0.25, 0].map((v) =>
    Math.round(v)
  );

  return (
    <div className="hub-chart-area">
      <div className="hub-chart-grid">
        {gridLines.map((v, idx) => (
          <div className="hub-grid-line" key={`${v}-${idx}`}>
            <span>{v}</span>
            <div></div>
          </div>
        ))}
      </div>

      <div className="hub-bars">
        {data.map((item, idx) => (
          <div className="hub-bar-group" key={item.label} style={{ "--i": idx }}>
            {item.values.map((v, vIdx) => (
              <div
                key={vIdx}
                className="hub-bar"
                data-tooltip={v.tooltip ?? `${v.value.toLocaleString()}`}
                style={{
                  height: `${(v.value / max) * 100}%`,
                  background: v.color,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HubBarChartLabels({ labels }) {
  return (
    <div className="hub-chart-labels">
      {labels.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  );
}

/**
 * segments: [{ label, value, color }]
 */
export function HubDonut({ segments, centerLabel = "Total" }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  const gradient = useMemo(() => {
    let current = 0;
    return segments
      .map((s) => {
        const start = (current / total) * 360;
        current += s.value;
        const end = (current / total) * 360;
        return `${s.color} ${start}deg ${end}deg`;
      })
      .join(", ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, total]);

  return (
    <div className="hub-donut-wrapper">
      <div className="hub-donut" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="hub-donut-inner">
          <strong>{total.toLocaleString()}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>

      <div className="hub-legend">
        {segments.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label} — {s.value.toLocaleString()}
          </span>
        ))}
      </div>
    </div>
  );
}