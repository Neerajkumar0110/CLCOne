import React, { useMemo, useState } from "react";
import { request } from "@/request";
import { useTheme } from "@/context/themeContext";
import KpiGrid from "@/components/dashboard/KpiGrid";
import RatioStrip from "@/components/dashboard/RatioStrip";
import ChartCard from "@/components/dashboard/ChartCard";
import FunnelChart from "@/components/dashboard/FunnelChart";
import AdvancedTable from "@/components/dashboard/AdvancedTable";
import { applyChartTheme } from "@/components/dashboard/chartTheme";

const CHART_TITLE = {
  trend: "Monthly Trend",
  bySource: "By Lead Source",
  byType: "By Campaign Type",
  sourceRoi: "Lead Source — ROI %",
};
const chartKind = (key, raw) => {
  if (key === "trend") return "area";
  if ((raw?.labels || []).length > 6) return "bar";
  return "bar";
};

const COLUMNS = {
  leads: [
    { key: "name", label: "Name", type: "text" },
    { key: "phone", label: "Phone", type: "text" },
    { key: "source", label: "Source", type: "text" },
    { key: "stage", label: "Stage", type: "badge" },
    { key: "assignedUserName", label: "Owner", type: "text" },
    { key: "team", label: "Team", type: "text" },
    { key: "country", label: "Country", type: "text", defaultHidden: true },
    { key: "created", label: "Created", type: "date" },
  ],
  campaigns: [
    { key: "name", label: "Campaign", type: "text" },
    { key: "type", label: "Type", type: "badge" },
    { key: "status", label: "Status", type: "badge" },
    { key: "budget", label: "Budget", type: "number" },
    { key: "actualSpend", label: "Spend", type: "number" },
    { key: "leads", label: "Leads", type: "number" },
    { key: "conversions", label: "Conv.", type: "number" },
    { key: "revenue", label: "Revenue", type: "number" },
    { key: "startDate", label: "Start", type: "date" },
  ],
};

/**
 * One premium renderer for every MarketingHub leaf (manual / leads / campaigns)
 * and the Master rollup — KPI grid with sparklines + Δ, ratio strip, charts,
 * marketing funnel, and a drill-through data table. `data` is the premium
 * payload from /marketing-hub/dashboard/:key or /marketing-hub/master.
 */
export default function LeafDashboard({ leafKey, data, loading, query }) {
  const { isDark } = useTheme();
  applyChartTheme(isDark);
  const themeKey = isDark ? "d" : "l";

  const [tableRows, setTableRows] = useState([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [drill, setDrill] = useState(null);

  const serverTable = data?.table?.mode === "server";
  const source = data?.source;

  // Fetch drill-through records once per leaf/query for leads & campaigns leaves.
  React.useEffect(() => {
    setDrill(null);
    if (!serverTable || !leafKey) {
      setTableRows([]);
      return;
    }
    let alive = true;
    setTableLoading(true);
    const qs = new URLSearchParams({ ...query, page: "1", items: "500" }).toString();
    request.get({ entity: `marketing-hub/rows/${leafKey}?${qs}` }).then((r) => {
      if (!alive) return;
      setTableRows(r?.success ? r.result : []);
      setTableLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [leafKey, serverTable, JSON.stringify(query)]);

  const chartDefs = useMemo(() => {
    const c = data?.charts || {};
    return Object.keys(c).map((key) => ({
      key,
      title: CHART_TITLE[key] || key,
      kind: chartKind(key, c[key]),
      span: key === "trend" ? 2 : undefined,
    }));
  }, [data]);

  const tableColumns = serverTable
    ? COLUMNS[source] || COLUMNS.leads
    : columnsFromRows(data?.table?.rows || []);
  const rows = serverTable ? tableRows : data?.table?.rows || [];

  if (loading && !data) {
    return (
      <div className="hub-card">
        <div className="hub-skel" style={{ height: 14, width: "40%" }} />
        <div className="dash-kpi-grid" style={{ marginTop: 16 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="dash-kpi">
              <div className="hub-skel" style={{ height: 12, width: "60%" }} />
              <div className="hub-skel" style={{ height: 24, width: "45%", marginTop: 10 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!data) return null;

  const allZero = (data.kpis || []).length > 0 && data.kpis.every((k) => !k.value && !k.prev);

  return (
    <div className="hub-stack dash-shell" style={{ minWidth: 0 }}>
      <KpiGrid
        defs={data.kpis || []}
        kpis={data.kpis || []}
        loading={loading}
        activeDrill={drill}
        onDrill={setDrill}
      />

      {allZero && !loading && (
        <div className="hub-card">
          <div className="hub-empty">No data for this slice / period yet.</div>
        </div>
      )}

      <RatioStrip defs={data.ratios || []} ratios={data.ratios || []} loading={loading} />

      <div className="dash-charts-grid" key={themeKey}>
        {chartDefs.map((def) => (
          <ChartCard key={def.key} def={def} raw={data.charts[def.key]} onSegmentDrill={setDrill} />
        ))}
      </div>

      {Array.isArray(data.funnel) && data.funnel.length >= 2 && (
        <FunnelChart
          def={{ title: "Marketing Funnel", stages: data.funnel.map((f) => ({ key: f.key, label: f.label, drill: f.drill })) }}
          rows={data.funnel}
          activeDrill={drill}
          onStageDrill={setDrill}
        />
      )}

      {Array.isArray(data.ranking) && data.ranking.length > 0 && <SourceRoiRanking ranking={data.ranking} />}

      <AdvancedTable
        module={leafKey || "marketing"}
        meta={{ mode: "client", total: rows.length }}
        columns={tableColumns}
        rows={rows}
        query={query}
        drill={drill}
        onClearDrill={() => setDrill(null)}
        rowActions={{ view: true }}
      />
      {tableLoading && <div className="hub-empty">Loading records…</div>}
    </div>
  );
}

function columnsFromRows(rows) {
  if (!rows.length) return [{ key: "month", label: "Month", type: "text" }];
  const keys = Object.keys(rows[0]).filter((k) => k !== "id");
  return keys.map((k) => ({
    key: k,
    label: k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
    type: /month|date/i.test(k) ? "date" : typeof rows[0][k] === "number" ? "number" : "text",
  }));
}

function SourceRoiRanking({ ranking }) {
  const money = (v) => `₹${Math.round(v || 0).toLocaleString()}`;
  return (
    <div className="hub-card hub-fade-up">
      <div className="hub-card-header">
        <h3>Lead Source ROI Ranking</h3>
      </div>
      <div className="hub-table-wrapper">
        <table className="hub-table" style={{ minWidth: 0, width: "100%" }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Source</th>
              <th style={{ textAlign: "right" }}>Leads</th>
              <th style={{ textAlign: "right" }}>Enrolled</th>
              <th style={{ textAlign: "right" }}>Spend</th>
              <th style={{ textAlign: "right" }}>Revenue</th>
              <th style={{ textAlign: "right" }}>CPL</th>
              <th style={{ textAlign: "right" }}>ROAS</th>
              <th style={{ textAlign: "right" }}>ROI %</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((r, i) => (
              <tr key={r.source}>
                <td>{i + 1}</td>
                <td>
                  {r.source}
                  {r.flag === "best" && <span className="hub-badge hub-badge-green" style={{ marginLeft: 6 }}>Best</span>}
                  {r.flag === "worst" && <span className="hub-badge hub-badge-red" style={{ marginLeft: 6 }}>Worst</span>}
                </td>
                <td style={{ textAlign: "right" }}>{r.leads}</td>
                <td style={{ textAlign: "right" }}>{r.enrolled}</td>
                <td style={{ textAlign: "right" }}>{r.spend ? money(r.spend) : "—"}</td>
                <td style={{ textAlign: "right" }}>{r.revenue ? money(r.revenue) : "—"}</td>
                <td style={{ textAlign: "right" }}>{r.cpl ? money(r.cpl) : "—"}</td>
                <td style={{ textAlign: "right" }}>{r.roas ? `${r.roas}×` : "—"}</td>
                <td style={{ textAlign: "right", color: r.roi >= 0 ? "var(--hub-green)" : "var(--hub-red)", fontWeight: 700 }}>
                  {r.spend ? `${r.roi}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
