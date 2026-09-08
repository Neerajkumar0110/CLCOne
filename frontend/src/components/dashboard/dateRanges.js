import dayjs from "dayjs";

// Central date-range logic for every analytics dashboard. All ranges are
// [from, to] inclusive-ish (to = end of the last day) and returned as native
// Date objects; the shell serialises them to ISO for the API.

export const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 Days" },
  { key: "15d", label: "Last 15 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "60d", label: "Last 60 Days" },
  { key: "90d", label: "Last 90 Days" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "thisQuarter", label: "This Quarter" },
  { key: "thisYear", label: "This Year" },
  { key: "custom", label: "Custom Range" },
];

export const QUICK_DAYS = [15, 30, 60, 90];
export const DEFAULT_PRESET = "30d";

// N-day window ending now (today counts as one of the N days).
export function quickRange(days) {
  const to = dayjs().endOf("day");
  const from = to.subtract(days - 1, "day").startOf("day");
  return { from: from.toDate(), to: to.toDate() };
}

export function rangeForPreset(key) {
  const now = dayjs();
  switch (key) {
    case "today":
      return { from: now.startOf("day").toDate(), to: now.endOf("day").toDate() };
    case "yesterday": {
      const y = now.subtract(1, "day");
      return { from: y.startOf("day").toDate(), to: y.endOf("day").toDate() };
    }
    case "7d":
      return quickRange(7);
    case "15d":
      return quickRange(15);
    case "30d":
      return quickRange(30);
    case "60d":
      return quickRange(60);
    case "90d":
      return quickRange(90);
    case "thisMonth":
      return { from: now.startOf("month").toDate(), to: now.endOf("day").toDate() };
    case "lastMonth": {
      const m = now.subtract(1, "month");
      return { from: m.startOf("month").toDate(), to: m.endOf("month").toDate() };
    }
    case "thisQuarter": {
      const q = Math.floor(now.month() / 3);
      const start = now.month(q * 3).startOf("month");
      return { from: start.toDate(), to: now.endOf("day").toDate() };
    }
    case "thisYear":
      return { from: now.startOf("year").toDate(), to: now.endOf("day").toDate() };
    default:
      return quickRange(30);
  }
}

// Which preset key (if any) an arbitrary [from,to] matches — used to keep the
// quick-button / dropdown selection in sync after a custom pick.
export function presetForRange(from, to) {
  for (const p of PRESETS) {
    if (p.key === "custom") continue;
    const r = rangeForPreset(p.key);
    if (
      Math.abs(dayjs(r.from).diff(from, "minute")) < 2 &&
      Math.abs(dayjs(r.to).diff(to, "minute")) < 2
    ) {
      return p.key;
    }
  }
  return "custom";
}

// The immediately-preceding equal-length window, for "vs previous period".
export function previousWindow(from, to) {
  const len = dayjs(to).valueOf() - dayjs(from).valueOf();
  const prevTo = dayjs(from).valueOf();
  const prevFrom = prevTo - len;
  return { prevFrom: new Date(prevFrom), prevTo: new Date(prevTo) };
}

// Bucket granularity for trend charts + sparklines.
export function bucketOf(from, to) {
  const days = dayjs(to).diff(from, "day");
  if (days <= 31) return "day";
  if (days <= 180) return "week";
  return "month";
}
