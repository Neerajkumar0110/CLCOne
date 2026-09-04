import React, { useEffect, useRef } from "react";
import {
  Chart,
  BarController,
  BarElement,
  DoughnutController,
  ArcElement,
  RadarController,
  RadialLinearScale,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

Chart.register(
  BarController,
  BarElement,
  DoughnutController,
  ArcElement,
  RadarController,
  RadialLinearScale,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler
);

Chart.defaults.font.family =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
Chart.defaults.font.size = 11.5;
Chart.defaults.color = "#64748b";
Chart.defaults.animation.duration = 850;
Chart.defaults.animation.easing = "easeOutQuart";
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.boxWidth = 8;
Chart.defaults.plugins.legend.labels.boxHeight = 8;
Chart.defaults.plugins.legend.labels.padding = 14;
Chart.defaults.plugins.tooltip.backgroundColor = "rgba(15,23,42,0.94)";
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 10;
Chart.defaults.plugins.tooltip.titleFont = { weight: "700", size: 12 };
Chart.defaults.plugins.tooltip.bodyFont = { size: 11.5 };
Chart.defaults.plugins.tooltip.usePointStyle = true;
Chart.defaults.plugins.tooltip.boxPadding = 5;

// Solid, high-contrast palette (no CanvasGradient — those render black when
// the chart area isn't measured yet). Reliable everywhere.
export const PALETTE = {
  blue: "#3B82F6",
  green: "#10B981",
  amber: "#F59E0B",
  red: "#EF4444",
  purple: "#8B5CF6",
  cyan: "#06B6D4",
  pink: "#EC4899",
  slate: "#64748B",
  track: "#EEF2F7",
  ink: "#0F172A",
  grid: "rgba(148,163,184,0.16)",
};
// translucent fill for area charts — plain rgba string, never a gradient obj.
export function fillRgba(hex, a = 0.14) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Inline value-label plugin (no extra dependency).
const valueLabels = {
  id: "valueLabels",
  afterDatasetsDraw(chart, _a, opts) {
    if (!opts) return;
    const { ctx } = chart;
    const fmt = opts.fmt || ((v) => v);
    ctx.save();
    ctx.font = "700 11px " + Chart.defaults.font.family;
    ctx.fillStyle = opts.color || "#0f172a";
    chart.data.datasets.forEach((ds, di) => {
      if (ds.hidden) return;
      const meta = chart.getDatasetMeta(di);
      if (meta.type !== "bar") return;
      const horizontal = chart.options.indexAxis === "y";
      meta.data.forEach((el, i) => {
        const v = ds.data[i];
        if (v == null || v === 0) return;
        ctx.textAlign = horizontal ? "left" : "center";
        ctx.textBaseline = horizontal ? "middle" : "bottom";
        ctx.fillText(
          fmt(v, i, di),
          horizontal ? el.x + (opts.offset ?? 6) : el.x,
          horizontal ? el.y : el.y - (opts.offset ?? 6)
        );
      });
    });
    ctx.restore();
  },
};
Chart.register(valueLabels);

export default function ChartCanvas({ type, data, options, height = 240 }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const baseOpts = () => ({
    responsive: true,
    maintainAspectRatio: false,
    resizeDelay: 60,
    interaction: { mode: "nearest", intersect: false },
    ...options,
  });

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    chartRef.current = new Chart(canvasRef.current, { type, data, options: baseOpts() });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    c.data = data;
    c.options = baseOpts();
    c.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, options]);

  return (
    <div style={{ position: "relative", width: "100%", minWidth: 0, height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// ── Radial gauge (3/4 speedometer, solid arc) ────────────────────────
export function Gauge({ value, label, sub, color = PALETTE.blue, height = 176 }) {
  const pct = Math.max(0, Math.min(100, (value || 0) * 100));
  return (
    <div style={{ position: "relative", width: "100%", minWidth: 0, height }}>
      <ChartCanvas
        type="doughnut"
        height={height}
        data={{
          labels: ["", ""],
          datasets: [
            {
              data: [pct, Math.max(0.0001, 100 - pct)],
              backgroundColor: [color, PALETTE.track],
              borderWidth: 0,
              borderRadius: [{ outerStart: 6, outerEnd: 6, innerStart: 6, innerEnd: 6 }, 0],
              circumference: 270,
              rotation: 225,
            },
          ],
        }}
        options={{
          cutout: "74%",
          animation: { animateRotate: true, duration: 900 },
          plugins: { legend: { display: false }, tooltip: { enabled: false }, valueLabels: false },
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <div>
          <div style={{ fontSize: 23, fontWeight: 800, color: PALETTE.ink, lineHeight: 1 }}>
            {pct.toFixed(pct % 1 ? 1 : 0)}%
          </div>
          <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 4, fontWeight: 600 }}>{label}</div>
          {sub != null && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}
