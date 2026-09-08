// Value formatting + status→badge mapping shared across the analytics shell.

export function fmtInt(n) {
  return Math.round(Number(n) || 0).toLocaleString("en-IN");
}

export function fmtMoney(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `₹${(v / 1e3).toFixed(1)}k`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

export function fmtPct(n) {
  return `${(Number(n) || 0).toFixed(1)}%`;
}

export function fmtSec(s) {
  s = Math.round(Number(s) || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function fmtDays(n) {
  const v = Math.round(Number(n) || 0);
  return `${v}d`;
}

export function formatValue(value, fmt) {
  switch (fmt) {
    case "money":
      return fmtMoney(value);
    case "pct":
      return fmtPct(value);
    case "sec":
      return fmtSec(value);
    case "days":
      return fmtDays(value);
    default:
      return fmtInt(value);
  }
}

// A KPI is "good" when it moved the desired direction. positiveWhenDown flips
// the sign (loss / churn / failed / cancelled / invalid …).
export function trendMeta(deltaPct, positiveWhenDown) {
  const d = Number(deltaPct) || 0;
  if (d === 0) return { dir: "flat", good: null, arrow: "→", cls: "trend-flat" };
  const rising = d > 0;
  const good = positiveWhenDown ? !rising : rising;
  return {
    dir: rising ? "up" : "down",
    good,
    arrow: rising ? "▲" : "▼",
    cls: good ? "trend-good" : "trend-bad",
  };
}

const BADGE = {
  // greens
  active: "hub-badge-green", connected: "hub-badge-green", won: "hub-badge-green",
  "closed won": "hub-badge-green", accepted: "hub-badge-green", paid: "hub-badge-green",
  completed: "hub-badge-green", fulfilled: "hub-badge-green", invoiced: "hub-badge-green",
  enrolled: "hub-badge-green", delivered: "hub-badge-green", issued: "hub-badge-green",
  // reds
  lost: "hub-badge-red", "closed lost": "hub-badge-red", rejected: "hub-badge-red",
  cancelled: "hub-badge-red", failed: "hub-badge-red", missed: "hub-badge-red",
  unpaid: "hub-badge-red", dropped: "hub-badge-red", invalid: "hub-badge-red",
  "not interested": "hub-badge-red", discontinued: "hub-badge-red", expired: "hub-badge-red",
  // yellows
  pending: "hub-badge-yellow", "pending approval": "hub-badge-yellow", partial: "hub-badge-yellow",
  processing: "hub-badge-yellow", "on hold": "hub-badge-yellow", draft: "hub-badge-yellow",
  "no answer": "hub-badge-yellow", "no response": "hub-badge-yellow", busy: "hub-badge-yellow",
  deferred: "hub-badge-yellow", "partially fulfilled": "hub-badge-yellow",
  // blues / neutral
  new: "hub-badge-blue", "new lead": "hub-badge-blue", sent: "hub-badge-blue",
  confirmed: "hub-badge-blue", contacted: "hub-badge-blue", inbound: "hub-badge-blue",
  outbound: "hub-badge-blue", interested: "hub-badge-blue", qualification: "hub-badge-blue",
  waived: "hub-badge-gray", inactive: "hub-badge-gray",
};

export function badgeClassFor(value) {
  if (value == null || value === "") return "hub-badge-gray";
  return BADGE[String(value).toLowerCase().trim()] || "hub-badge-gray";
}
