import React, { useMemo, useState } from "react";

const WIDTH = 640;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 28, left: 40 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

function niceMax(peak) {
  if (peak <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(peak)));
  const step = magnitude / 2 || 1;
  return Math.ceil(peak / step) * step;
}

// Smooth path through every point exactly (no overshoot) — control points sit
// at the horizontal midpoint between each pair, per dataviz skill mark specs.
function smoothPath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = p0.x + (p1.x - p0.x) / 2;
    d += ` C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

// Multi-series smooth line + soft-fill area chart with a shared crosshair
// tooltip. Always renders its axes/gridlines/frame — with no data it shows a
// flat de-emphasized baseline instead of disappearing, per the empty-state
// component in the dataviz skill (chart shows up the moment data arrives).
export default function LineAreaChart({ data, seriesKeys, xKey }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  const hasData = data && data.length > 0;
  const n = hasData ? data.length : 1;

  const peak = hasData
    ? Math.max(1, ...data.flatMap((d) => seriesKeys.map((s) => Number(d[s.key]) || 0)))
    : 1;
  const max = hasData ? niceMax(peak * 1.15) : 10;

  const xFor = (i) => (n === 1 ? PAD.left + PLOT_W / 2 : PAD.left + (i / (n - 1)) * PLOT_W);
  const yFor = (v) => PAD.top + PLOT_H - (v / max) * PLOT_H;

  const seriesPaths = useMemo(() => {
    return seriesKeys.map((s) => {
      const points = hasData
        ? data.map((d, i) => ({ x: xFor(i), y: yFor(Number(d[s.key]) || 0) }))
        : [{ x: PAD.left, y: yFor(0) }, { x: PAD.left + PLOT_W, y: yFor(0) }];
      const linePath = smoothPath(points);
      const areaPath = hasData
        ? `${linePath} L ${points[points.length - 1].x} ${yFor(0)} L ${points[0].x} ${yFor(0)} Z`
        : "";
      return { ...s, points, linePath, areaPath };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, seriesKeys, max, n]);

  const gridValues = [0, max * 0.25, max * 0.5, max * 0.75, max];

  const handleMove = (e) => {
    if (!hasData) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const idx = Math.round(((relX - PAD.left) / PLOT_W) * (n - 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  };

  const activeX = hoverIdx !== null ? xFor(hoverIdx) : null;

  // Show every label when there's room, otherwise thin them out so they don't collide.
  const labelStride = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="viz-root" style={{ position: "relative" }}>
      <div className="viz-legend">
        {seriesKeys.map((s) => (
          <span key={s.key} className="viz-legend-item">
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="viz-svg"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        role="img"
        aria-label={`${seriesKeys.map((s) => s.label).join(" vs ")} over time`}
      >
        {gridValues.map((v, i) => {
          const y = yFor(v);
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={WIDTH - PAD.right} y2={y} className="viz-gridline" />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="viz-axis-label">
                {Math.round(v).toLocaleString()}
              </text>
            </g>
          );
        })}

        {hasData &&
          data.map((d, i) =>
            i % labelStride === 0 ? (
              <text key={i} x={xFor(i)} y={HEIGHT - 8} textAnchor="middle" className="viz-axis-label">
                {String(d[xKey]).slice(-6)}
              </text>
            ) : null
          )}

        {seriesPaths.map((s) => (
          <path key={`area-${s.key}`} d={s.areaPath} fill={hasData ? s.color : "var(--viz-muted)"} opacity={hasData ? 0.1 : 0.06} />
        ))}
        {seriesPaths.map((s) => (
          <path
            key={`line-${s.key}`}
            d={s.linePath}
            fill="none"
            stroke={hasData ? s.color : "var(--viz-muted)"}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {hasData && activeX !== null && (
          <line x1={activeX} y1={PAD.top} x2={activeX} y2={PAD.top + PLOT_H} className="viz-crosshair" />
        )}

        {hasData &&
          hoverIdx !== null &&
          seriesPaths.map((s) => (
            <circle key={`dot-${s.key}`} cx={s.points[hoverIdx].x} cy={s.points[hoverIdx].y} r={4} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />
          ))}

        {!hasData && (
          <text x={WIDTH / 2} y={PAD.top + PLOT_H / 2} textAnchor="middle" className="viz-empty-label">
            No data in this period
          </text>
        )}
      </svg>

      {hasData && hoverIdx !== null && (
        <div
          className="viz-tooltip"
          style={{
            left: `${(activeX / WIDTH) * 100}%`,
            top: 8,
          }}
        >
          <div className="viz-tooltip-title">{data[hoverIdx][xKey]}</div>
          {seriesKeys.map((s) => (
            <div className="viz-tooltip-row" key={s.key}>
              <span className="viz-tooltip-key" style={{ borderColor: s.color }} />
              <span className="viz-tooltip-label">{s.label}</span>
              <span className="viz-tooltip-value">{Number(data[hoverIdx][s.key] || 0).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
