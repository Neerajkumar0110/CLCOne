import React from "react";
import KpiCard from "./KpiCard";

export default function KpiGrid({ defs = [], kpis = [], loading, activeDrill, onDrill }) {
  const byKey = {};
  (kpis || []).forEach((k) => {
    byKey[k.key] = k;
  });

  if (loading && !kpis.length) {
    return (
      <div className="dash-kpi-grid">
        {defs.map((d) => (
          <div key={d.key} className="dash-kpi">
            <div className="hub-skel" style={{ width: "60%", height: 12 }} />
            <div className="hub-skel" style={{ width: "45%", height: 26, marginTop: 10 }} />
            <div className="hub-skel" style={{ width: "80%", height: 10, marginTop: 12 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="dash-kpi-grid">
      {defs.map((def, i) => (
        <KpiCard
          key={def.key}
          def={def}
          kpi={byKey[def.key]}
          index={i}
          active={activeDrill && def.drill && activeDrill.field === def.drill.field && activeDrill.label === def.drill.label}
          onDrill={onDrill}
        />
      ))}
    </div>
  );
}
