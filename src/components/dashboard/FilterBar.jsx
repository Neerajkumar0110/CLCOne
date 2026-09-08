import React from "react";
import dayjs from "dayjs";
import { DatePicker } from "antd";
import { ReloadOutlined, FilterOutlined } from "@ant-design/icons";
import BusinessTypeToggle from "./BusinessTypeToggle";
import { PRESETS, QUICK_DAYS } from "./dateRanges";

const { RangePicker } = DatePicker;

export default function FilterBar({
  from,
  to,
  presetKey,
  onPreset,
  onQuick,
  onCustomRange,
  businessTypeMode,
  businessType,
  onBusinessType,
  dateBasis,
  dateBasisOptions,
  onDateBasis,
  onOpenDrawer,
  activeDrawerCount = 0,
  onRefresh,
  loading,
}) {
  return (
    <div className="dash-filterbar">
      <select
        className="hub-select"
        style={{ maxWidth: 170 }}
        value={presetKey}
        onChange={(e) => onPreset(e.target.value)}
      >
        {PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>

      <div className="hub-pill-filter dash-quick">
        {QUICK_DAYS.map((d) => (
          <button
            key={d}
            type="button"
            className={`hub-pill-btn ${presetKey === `${d}d` ? "active" : ""}`}
            onClick={() => onQuick(d)}
          >
            {d}D
          </button>
        ))}
      </div>

      {presetKey === "custom" && (
        <RangePicker
          value={[from ? dayjs(from) : null, to ? dayjs(to) : null]}
          onChange={(vals) => {
            if (vals && vals[0] && vals[1]) {
              onCustomRange(vals[0].startOf("day").toDate(), vals[1].endOf("day").toDate());
            }
          }}
          allowClear={false}
        />
      )}

      {dateBasisOptions && dateBasisOptions.length > 1 && (
        <select
          className="hub-select"
          style={{ maxWidth: 170 }}
          value={dateBasis}
          onChange={(e) => onDateBasis(e.target.value)}
          title="Which date the range applies to"
        >
          {dateBasisOptions.map((o) => (
            <option key={o.key} value={o.key}>
              by {o.label}
            </option>
          ))}
        </select>
      )}

      <BusinessTypeToggle mode={businessTypeMode} value={businessType} onChange={onBusinessType} />

      <div className="dash-filterbar-spacer" />

      <button
        type="button"
        className={`hub-btn ${activeDrawerCount ? "hub-btn-primary" : ""}`}
        onClick={onOpenDrawer}
      >
        <FilterOutlined /> Filters
        {activeDrawerCount > 0 && <span className="dash-badge-count">{activeDrawerCount}</span>}
      </button>

      <button type="button" className="hub-btn" onClick={onRefresh} disabled={loading}>
        <ReloadOutlined spin={loading} /> Refresh
      </button>
    </div>
  );
}
