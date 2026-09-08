// Shared chart theming for the analytics dashboards. chart.js keeps a single
// global `Chart.defaults`, so we patch it whenever the app theme flips and
// expose a mutable THEME object for the per-chart option builders (barOpts,
// Gauge, config chart defs) to read instead of hard-coding light greys.
//
// Usage: <DashboardShell> calls applyChartTheme(isDark) in a layout effect and
// bumps a remount key so every <ChartCanvas> picks up the new defaults.
import { Chart } from "chart.js";

// Categorical hues — unchanged between themes (validated CVD-safe on both
// backgrounds). Mirrors PALETTE in ./ChartCanvas.jsx.
export const SERIES_COLORS = {
  blue: "#3B82F6",
  green: "#10B981",
  amber: "#F59E0B",
  red: "#EF4444",
  purple: "#8B5CF6",
  cyan: "#06B6D4",
  pink: "#EC4899",
  slate: "#64748B",
};

export const SERIES = [
  SERIES_COLORS.blue,
  SERIES_COLORS.green,
  SERIES_COLORS.amber,
  SERIES_COLORS.purple,
  SERIES_COLORS.cyan,
  SERIES_COLORS.pink,
  SERIES_COLORS.red,
  SERIES_COLORS.slate,
];

// Mutable — reassigned in place by applyChartTheme so existing imports keep
// their reference.
export const THEME = {
  dark: false,
  ink: "#0F172A", // primary label / value text drawn on canvas
  tick: "#64748b", // axis tick text
  grid: "rgba(148,163,184,0.16)", // grid lines
  track: "#EEF2F7", // "empty" arc / remainder fill
  surface: "#ffffff", // card background behind a chart
  tooltipBg: "rgba(15,23,42,0.94)",
};

const LIGHT = {
  ink: "#0F172A",
  tick: "#64748b",
  grid: "rgba(148,163,184,0.16)",
  track: "#EEF2F7",
  surface: "#ffffff",
  tooltipBg: "rgba(15,23,42,0.94)",
};

const DARK = {
  ink: "#e5e9f0",
  tick: "#8b95a7",
  grid: "rgba(148,163,184,0.14)",
  track: "#222c3c",
  surface: "#131a24",
  tooltipBg: "rgba(2,6,12,0.94)",
};

export function applyChartTheme(isDark) {
  const t = isDark ? DARK : LIGHT;
  THEME.dark = !!isDark;
  THEME.ink = t.ink;
  THEME.tick = t.tick;
  THEME.grid = t.grid;
  THEME.track = t.track;
  THEME.surface = t.surface;
  THEME.tooltipBg = t.tooltipBg;

  Chart.defaults.color = t.tick;
  Chart.defaults.borderColor = t.grid;
  Chart.defaults.plugins.tooltip.backgroundColor = t.tooltipBg;
  Chart.defaults.plugins.tooltip.titleColor = "#f8fafc";
  Chart.defaults.plugins.tooltip.bodyColor = "#e2e8f0";
}
