import React from "react";

export default function HubTabs({ tabs, active, onChange }) {
  return (
    <div className="hub-tabbar">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`hub-tab ${active === tab.key ? "active" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          {tab.icon}
          {tab.label}
          {!!tab.count && <span className="hub-tab-count">{tab.count > 99 ? "99+" : tab.count}</span>}
        </button>
      ))}
    </div>
  );
}