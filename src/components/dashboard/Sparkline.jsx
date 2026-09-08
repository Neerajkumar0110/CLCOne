import React, { useMemo } from "react";

/**
 * Inline-SVG sparkline. Deliberately not a chart.js instance — a KPI grid has
 * 8 of these and chart.js instances are expensive to spin up/tear down.
 *
 * @param {number[]} points
 * @param {string} color   stroke colour (also the faint area fill)
 * @param {number} height
 * @param {boolean} area   draw the translucent fill under the line
 */
export default function Sparkline({ points = [], color = "#3B82F6", height = 34, area = true }) {
  const W = 120;
  const H = height;
  const pad = 3;

  const { line, poly } = useMemo(() => {
    const vals = (points || []).map((n) => (Number.isFinite(n) ? n : 0));
    if (vals.length === 0) return { line: "", poly: "" };
    if (vals.length === 1) vals.unshift(vals[0]);

    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const stepX = (W - pad * 2) / (vals.length - 1);

    const xy = vals.map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (H - pad * 2) * (1 - (v - min) / span);
      return [x, y];
    });

    const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const poly =
      `M${pad},${H - pad} ` +
      xy.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(" ") +
      ` L${(W - pad).toFixed(1)},${H - pad} Z`;
    return { line, poly };
  }, [points, H]);

  if (!line) {
    return <div style={{ height: H }} aria-hidden="true" />;
  }

  const last = points[points.length - 1] ?? 0;
  const min = Math.min(...points.map((n) => (Number.isFinite(n) ? n : 0)));
  const max = Math.max(...points.map((n) => (Number.isFinite(n) ? n : 0)));
  const span = max - min || 1;
  const lastX = 120 - pad;
  const lastY = pad + (H - pad * 2) * (1 - (last - min) / span);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-hidden="true"
      style={{ display: "block", overflow: "visible" }}
    >
      {area && <path d={poly} fill={color} opacity="0.12" />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={Number.isFinite(lastY) ? lastY : H / 2} r="2" fill={color} />
    </svg>
  );
}
