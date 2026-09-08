import React, { useMemo, useState } from "react";
import { TableOutlined } from "@ant-design/icons";
import ChartCanvas, { PALETTE, fillRgba } from "./ChartCanvas";
import { THEME, SERIES } from "./chartTheme";

const num = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);

function buildConfig(kind, raw) {
  const labels = raw.labels || [];
  const dsIn = raw.datasets || [];
  const gridScale = {
    grid: { color: THEME.grid, drawBorder: false },
    border: { display: false },
    ticks: { color: THEME.tick },
  };

  if (kind === "donut") {
    const data = dsIn[0] ? dsIn[0].data : [];
    return {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: labels.map((_, i) => SERIES[i % SERIES.length]),
            borderColor: THEME.surface,
            borderWidth: 2,
          },
        ],
      },
      options: {
        cutout: "62%",
        plugins: { legend: { position: "bottom" }, valueLabels: false },
      },
    };
  }

  if (kind === "radar") {
    return {
      type: "radar",
      data: {
        labels,
        datasets: dsIn.map((d, i) => ({
          label: d.label,
          data: d.data,
          borderColor: SERIES[i % SERIES.length],
          backgroundColor: fillRgba(SERIES[i % SERIES.length], 0.14),
          borderWidth: 2,
          pointRadius: 3,
        })),
      },
      options: {
        scales: {
          r: {
            grid: { color: THEME.grid },
            angleLines: { color: THEME.grid },
            pointLabels: { color: THEME.tick, font: { size: 11 } },
            ticks: { backdropColor: "transparent", color: THEME.tick },
          },
        },
        plugins: { legend: { position: "bottom" }, valueLabels: false },
      },
    };
  }

  if (kind === "line" || kind === "area") {
    return {
      type: "line",
      data: {
        labels,
        datasets: dsIn.map((d, i) => {
          const c = SERIES[i % SERIES.length];
          return {
            label: d.label,
            data: d.data,
            borderColor: c,
            backgroundColor: kind === "area" ? fillRgba(c, 0.16) : "transparent",
            fill: kind === "area",
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 5,
            borderWidth: 2.5,
          };
        }),
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { y: { beginAtZero: true, ...gridScale }, x: { ...gridScale, grid: { display: false } } },
        plugins: { legend: { position: "bottom", display: dsIn.length > 1 }, valueLabels: false },
      },
    };
  }

  // bar / stackedBar — horizontal when many categories
  const horizontal = labels.length > 6 && dsIn.length <= 1;
  const stacked = kind === "stackedBar";
  return {
    type: "bar",
    data: {
      labels,
      datasets: dsIn.map((d, i) => ({
        label: d.label,
        data: d.data,
        backgroundColor:
          dsIn.length > 1 ? SERIES[i % SERIES.length] : labels.map((_, k) => SERIES[k % SERIES.length]),
        borderRadius: 6,
        borderSkipped: false,
      })),
    },
    options: {
      indexAxis: horizontal ? "y" : "x",
      layout: { padding: { right: horizontal ? 40 : 8, top: 18 } },
      scales: {
        x: { stacked, ...gridScale, grid: horizontal ? gridScale.grid : { display: false } },
        y: { stacked, beginAtZero: true, ...gridScale, grid: horizontal ? { display: false } : gridScale.grid },
      },
      plugins: {
        legend: { position: "bottom", display: dsIn.length > 1 },
        valueLabels: dsIn.length <= 1 ? { fmt: (v) => num(v) } : false,
      },
    },
  };
}

export default function ChartCard({ def, raw, onSegmentDrill, height = 260 }) {
  const [showNumbers, setShowNumbers] = useState(false);
  const data = raw || { labels: [], datasets: [] };
  const isEmpty =
    !data.datasets ||
    data.datasets.length === 0 ||
    data.datasets.every((d) => (d.data || []).every((v) => !v));

  const cfg = useMemo(() => buildConfig(def.kind, data), [def.kind, data]);

  return (
    <div className="hub-card dash-chart-card hub-fade-up" style={{ gridColumn: def.span === 2 ? "span 2" : undefined }}>
      <div className="hub-card-header">
        <h3>{def.title}</h3>
        <button
          type="button"
          className={`hub-btn ${showNumbers ? "hub-btn-primary" : ""}`}
          style={{ padding: "3px 8px" }}
          onClick={() => setShowNumbers((v) => !v)}
          title="Show values"
        >
          <TableOutlined />
        </button>
      </div>

      {isEmpty ? (
        <div className="hub-empty">No data for this range.</div>
      ) : showNumbers ? (
        <NumbersTable data={data} />
      ) : (
        <ChartCanvas
          type={cfg.type}
          data={cfg.data}
          options={cfg.options}
          height={height}
          onElementClick={
            def.onSegmentDrill
              ? (index) => {
                  const drill = def.onSegmentDrill(index, data.labels[index]);
                  if (drill && onSegmentDrill) onSegmentDrill(drill);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function NumbersTable({ data }) {
  const rows = (data.labels || []).map((label, i) => [
    label,
    ...(data.datasets || []).map((d) => d.data[i]),
  ]);
  return (
    <table className="dash-numbers">
      <thead>
        <tr>
          <th />
          {(data.datasets || []).map((d) => (
            <th key={d.label}>{d.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]}>
            {r.map((c, i) => (
              <td key={i} style={i ? { textAlign: "right", fontWeight: 700 } : { fontWeight: 600 }}>
                {typeof c === "number" ? Math.round(c).toLocaleString() : c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
