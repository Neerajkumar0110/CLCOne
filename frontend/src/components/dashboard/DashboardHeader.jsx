import React from "react";

export default function DashboardHeader({ title, subtitle, actions }) {
  return (
    <div className="hub-card dash-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="dash-header-actions">{actions}</div>}
    </div>
  );
}
