import React, { useEffect, useMemo, useState } from "react";
import { request } from "@/request";
import { useTheme } from "@/context/themeContext";
import ChartCard from "@/components/dashboard/ChartCard";
import { applyChartTheme, SERIES } from "@/components/dashboard/chartTheme";
import { formatValue, trendMeta } from "@/components/dashboard/formatters";

const DIMS = [
  { key: "region", label: "India vs USA" },
  { key: "business", label: "B2B vs B2C" },
  { key: "system", label: "Human vs AI" },
];

// Side-by-side comparison of the Master rollup (or a leaf) across a dimension.
export default function ComparePanel({ compareKey = "master", query }) {
  const { isDark } = useTheme();
  applyChartTheme(isDark);
  const [dimension, setDimension] = useState("region");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ ...query, key: compareKey, dimension }).toString();
    request.get({ entity: `marketing-hub/compare?${qs}` }).then((r) => {
      if (!alive) return;
      if (r?.success) setData(r.result);
      else setError(r?.message || "Failed to load comparison.");
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [compareKey, dimension, JSON.stringify(query)]);

  const slices = data?.slices || [];

  // metric keys shared across every slice's kpis
  const metricKeys = useMemo(() => {
    if (!slices.length) return [];
    const first = slices[0].kpis || [];
    return first.map((k) => ({ key: k.key, label: k.label, fmt: k.fmt }));
  }, [slices]);

  const groupedCharts = useMemo(() => {
    if (!slices.length) return [];
    return ["leads", "qualified", "enrollments", "revenue", "spend", "roi"]
      .filter((mk) => (slices[0].kpis || []).some((k) => k.key === mk))
      .map((mk) => {
        const def = slices[0].kpis.find((k) => k.key === mk);
        return {
          key: mk,
          title: def?.label || mk,
          raw: {
            labels: slices.map((s) => s.label),
            datasets: [
              {
                label: def?.label || mk,
                data: slices.map((s) => (s.kpis.find((k) => k.key === mk) || {}).value || 0),
              },
            ],
          },
        };
      });
  }, [slices]);

  return (
    <div className="hub-stack dash-shell" style={{ minWidth: 0 }}>
      <div className="hub-card">
        <div className="hub-card-header" style={{ flexWrap: "wrap", gap: 10 }}>
          <h3>Comparison</h3>
          <div className="hub-pill-filter">
            {DIMS.map((d) => (
              <button
                key={d.key}
                type="button"
                className={`hub-pill-btn ${dimension === d.key ? "active" : ""}`}
                onClick={() => setDimension(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="hub-empty">{error}</div>}
        {loading && !data && <div className="hub-empty">Loading comparison…</div>}

        {!loading && slices.length > 0 && (
          <div className="mkt-compare-grid" style={{ gridTemplateColumns: `160px repeat(${slices.length}, minmax(0,1fr))` }}>
            <div className="mkt-compare-head" />
            {slices.map((s, i) => (
              <div key={s.label} className="mkt-compare-head" style={{ color: SERIES[i % SERIES.length] }}>
                {s.label}
              </div>
            ))}
            {metricKeys.map((m) => {
              const vals = slices.map((s) => (s.kpis.find((k) => k.key === m.key) || {}).value || 0);
              const best = Math.max(...vals);
              return (
                <React.Fragment key={m.key}>
                  <div className="mkt-compare-metric">{m.label}</div>
                  {slices.map((s, i) => {
                    const kp = s.kpis.find((k) => k.key === m.key) || {};
                    const t = trendMeta(kp.deltaPct, kp.positiveWhenDown);
                    return (
                      <div key={s.label} className={`mkt-compare-cell ${vals[i] === best && best ? "is-best" : ""}`}>
                        <span className="mkt-compare-val">{formatValue(kp.value || 0, m.fmt)}</span>
                        {kp.deltaPct != null && (
                          <span className="mkt-compare-delta" style={{ color: t.good ? "var(--hub-green)" : t.good === false ? "var(--hub-red)" : "var(--hub-muted)" }}>
                            {t.arrow} {Math.abs(kp.deltaPct).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {groupedCharts.length > 0 && (
        <div className="dash-charts-grid" key={isDark ? "d" : "l"}>
          {groupedCharts.map((c) => (
            <ChartCard key={c.key} def={{ key: c.key, title: c.title, kind: "bar" }} raw={c.raw} />
          ))}
        </div>
      )}
    </div>
  );
}
