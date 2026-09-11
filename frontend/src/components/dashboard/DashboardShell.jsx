import React, { useEffect, useMemo, useState } from "react";
import "./dashboard.css";
import { useTheme } from "@/context/themeContext";
import { BorderTrail } from "@/components/ui/border-trail";
import { startPoll } from "@/utils/poll";
import DashboardHeader from "./DashboardHeader";
import FilterBar from "./FilterBar";
import KpiGrid from "./KpiGrid";
import RatioStrip from "./RatioStrip";
import ChartCard from "./ChartCard";
import FunnelChart from "./FunnelChart";
import AdvancedTable from "./AdvancedTable";
import FilterDrawer from "./FilterDrawer";
import useDashboardData from "./useDashboardData";
import { applyChartTheme } from "./chartTheme";
import { DEFAULT_PRESET, rangeForPreset, quickRange, presetForRange } from "./dateRanges";

/**
 * One shell for every analytics dashboard. Everything that differs between the
 * 9 dashboards lives in `config` (see components/dashboard/configs/*).
 */
export default function DashboardShell({ module, config, extraActions, live = false, onRecordEdit }) {
  const { isDark } = useTheme();

  const [presetKey, setPresetKey] = useState(DEFAULT_PRESET);
  const [range, setRange] = useState(() => rangeForPreset(DEFAULT_PRESET));
  const [businessType, setBusinessType] = useState("all");
  const [dateBasis, setDateBasis] = useState(config.dateBasis ? config.dateBasis.default : "created");
  const [drawer, setDrawer] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tableFilter, setTableFilter] = useState(null);

  // Re-theme charts synchronously (idempotent object mutation) so a child
  // <ChartCard> useMemo reads the right palette on the same render, then bump a
  // remount key so cached chart.js options are rebuilt.
  applyChartTheme(isDark);
  const chartKey = isDark ? "d" : "l";

  const query = useMemo(
    () => ({ from: range.from, to: range.to, businessType, dateBasis, drawer }),
    [range, businessType, dateBasis, drawer]
  );

  const { data, loading, error, reload } = useDashboardData(module, query);

  // Live refresh (Calls / Overview) while not on a custom range.
  useEffect(() => {
    if (!live || presetKey === "custom") return undefined;
    return startPoll(reload, 15000);
  }, [live, presetKey, reload]);

  // Any filter change clears an active drill.
  const clearDrill = () => setTableFilter(null);
  useEffect(() => {
    setTableFilter(null);
  }, [range, businessType, dateBasis, drawer]);

  const setPreset = (key) => {
    setPresetKey(key);
    if (key !== "custom") setRange(rangeForPreset(key));
  };
  const setQuick = (days) => {
    setPresetKey(`${days}d`);
    setRange(quickRange(days));
  };
  const setCustomRange = (from, to) => {
    setRange({ from, to });
    setPresetKey(presetForRange(from, to));
  };

  const drawerCount = Object.values(drawer).filter(
    (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)
  ).length;

  const facets = (data && data.facets) || {};
  const allZero =
    data && data.kpis && data.kpis.length > 0 && data.kpis.every((k) => !k.value && !k.prev);

  return (
    <div className="hub-stack dash-shell border-trail-shell" style={{ minWidth: 0 }}>
      <BorderTrail
        className="bg-gradient-to-l from-zinc-300 via-zinc-500 to-zinc-300 dark:from-zinc-700 dark:via-zinc-400 dark:to-zinc-700"
        size={120}
      />
      <DashboardHeader title={config.title} subtitle={config.subtitle} actions={extraActions} />

      <div className="hub-card dash-filter-card">
        <FilterBar
          from={range.from}
          to={range.to}
          presetKey={presetKey}
          onPreset={setPreset}
          onQuick={setQuick}
          onCustomRange={setCustomRange}
          businessTypeMode={config.businessTypeMode}
          businessType={businessType}
          onBusinessType={setBusinessType}
          dateBasis={dateBasis}
          dateBasisOptions={config.dateBasis ? config.dateBasis.options : null}
          onDateBasis={setDateBasis}
          onOpenDrawer={() => setDrawerOpen(true)}
          activeDrawerCount={drawerCount}
          onRefresh={reload}
          loading={loading}
        />
        {data && data.scope && data.scope !== "company" && (
          <div className="dash-scope-note">
            Showing your own scope ({data.scope}). Management roles see company-wide figures.
          </div>
        )}
      </div>

      {error && (
        <div className="hub-card">
          <div className="hub-notice">
            <span>{error}</span>
            <button type="button" className="hub-btn hub-btn-primary" style={{ marginLeft: 12 }} onClick={reload}>
              Retry
            </button>
          </div>
        </div>
      )}

      <KpiGrid
        defs={config.kpis || []}
        kpis={(data && data.kpis) || []}
        loading={loading}
        activeDrill={tableFilter}
        onDrill={setTableFilter}
      />

      {allZero && !loading && (
        <div className="hub-card">
          <div className="hub-empty">No activity in this period. Try a wider date range or clear filters.</div>
        </div>
      )}

      <RatioStrip defs={config.ratios || []} ratios={(data && data.ratios) || []} loading={loading} />

      <div className="dash-charts-grid" key={chartKey}>
        {(() => {
          const charts = config.charts || [];
          // If an odd number of half-width cards would leave a gap on the last
          // row, stretch the final half-width card to span both columns.
          const halfIdxs = charts.map((c, i) => (c.span === 2 ? -1 : i)).filter((i) => i >= 0);
          const stretchIdx = halfIdxs.length % 2 === 1 ? halfIdxs[halfIdxs.length - 1] : -1;
          return charts.map((def, i) => (
            <ChartCard
              key={def.key}
              def={i === stretchIdx ? { ...def, span: 2 } : def}
              raw={data && data.charts ? data.charts[def.key] : null}
              onSegmentDrill={setTableFilter}
            />
          ));
        })()}
      </div>

      {config.funnel && (
        <FunnelChart
          def={config.funnel}
          rows={(data && data.funnel) || []}
          activeDrill={tableFilter}
          onStageDrill={setTableFilter}
        />
      )}

      {config.table && (
        <AdvancedTable
          module={module}
          meta={{ mode: config.table.mode, ...(data && data.table ? data.table.meta : {}) }}
          columns={config.table.columns || []}
          rows={data && data.table ? data.table.rows || [] : []}
          query={query}
          drill={tableFilter}
          onClearDrill={clearDrill}
          rowActions={{
            ...(config.table.rowActions || {}),
            ...(onRecordEdit && (config.table.rowActions || {}).edit === true
              ? { onEdit: onRecordEdit }
              : {}),
          }}
        />
      )}

      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        fields={config.filterDrawer || []}
        facets={facets}
        value={drawer}
        onApply={setDrawer}
      />
    </div>
  );
}
