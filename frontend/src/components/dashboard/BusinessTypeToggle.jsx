import React from "react";
import { Tooltip } from "antd";

const OPTS = [
  { key: "all", label: "All" },
  { key: "b2b", label: "B2B" },
  { key: "b2c", label: "B2C" },
];

const TIP = {
  team: null,
  derived:
    "B2B / B2C is inferred from each record owner's team. Records whose owner isn't on a classified team show only under All.",
  disabled: "B2B / B2C isn't tracked for this module.",
};

/**
 * ALL | B2B | B2C segmented control.
 * @param {'team'|'derived'|'disabled'} mode
 */
export default function BusinessTypeToggle({ mode = "team", value = "all", lockedTo = null, onChange }) {
  const disabled = mode === "disabled";
  // lockedTo ('B2B' | 'B2C'): only that segment's button — no All, no other.
  const opts = lockedTo ? OPTS.filter((o) => o.key === lockedTo.toLowerCase()) : OPTS;
  const control = (
    <div className={`dash-seg ${disabled ? "dash-seg-disabled" : ""}`} role="group" aria-label="Business type">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`dash-seg-btn ${value === o.key ? "active" : ""}`}
          disabled={disabled}
          onClick={() => !disabled && onChange && onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  return TIP[mode] ? (
    <Tooltip title={TIP[mode]}>{control}</Tooltip>
  ) : (
    control
  );
}
