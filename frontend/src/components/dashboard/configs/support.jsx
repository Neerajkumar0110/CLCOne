const STATUSES = ["Open", "In Progress", "Resolved"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

export default {
  module: "support",
  title: "Support Analytics",
  subtitle: "Ticket queue — volume, priority and resolution",
  businessTypeMode: "disabled",
  kpis: [
    { key: "total", label: "Total Tickets", fmt: "int" },
    { key: "open", label: "Open", fmt: "int", positiveWhenDown: true, drill: { field: "status", op: "eq", value: "Open", label: "Open" } },
    { key: "inProgress", label: "In Progress", fmt: "int", drill: { field: "status", op: "eq", value: "In Progress", label: "In Progress" } },
    { key: "resolved", label: "Resolved", fmt: "int", drill: { field: "status", op: "eq", value: "Resolved", label: "Resolved" } },
    { key: "unresolved", label: "Unresolved (Open + In Progress)", fmt: "int", positiveWhenDown: true },
    { key: "urgent", label: "Urgent — still open", fmt: "int", positiveWhenDown: true, drill: { field: "priority", op: "eq", value: "Urgent", label: "Urgent" } },
    { key: "high", label: "High priority — still open", fmt: "int", positiveWhenDown: true, drill: { field: "priority", op: "eq", value: "High", label: "High priority" } },
  ],
  ratios: [{ key: "resolvedPct", label: "Resolved %" }],
  charts: [
    { key: "trend", title: "Tickets Raised Over Time", kind: "line", span: 2 },
    { key: "byStatus", title: "Tickets by Status", kind: "bar", onSegmentDrill: (i, label) => ({ field: "status", op: "eq", value: label, label: `Status: ${label}` }) },
    { key: "byPriority", title: "Tickets by Priority", kind: "donut", onSegmentDrill: (i, label) => ({ field: "priority", op: "eq", value: label, label: `Priority: ${label}` }) },
    { key: "byCategory", title: "Tickets by Category", kind: "bar", span: 2, onSegmentDrill: (i, label) => ({ field: "category", op: "eq", value: label, label: `Category: ${label}` }) },
  ],
  funnel: {
    title: "Ticket Lifecycle",
    stages: [
      { key: "raised", label: "Raised" },
      { key: "beingWorked", label: "In Progress" },
      { key: "resolved", label: "Resolved", drill: { field: "status", op: "eq", value: "Resolved", label: "Resolved" } },
    ],
  },
  table: {
    mode: "client",
    columns: [
      { key: "subject", label: "Subject", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "priority", label: "Priority", type: "badge" },
      { key: "status", label: "Status", type: "badge" },
      { key: "raisedByName", label: "Raised by", type: "text" },
      { key: "created", label: "Raised", type: "date" },
    ],
    rowActions: { view: true, edit: false, delete: false },
  },
  filterDrawer: [
    { key: "status", label: "Status", kind: "multiselect", options: STATUSES },
    { key: "priority", label: "Priority", kind: "multiselect", options: PRIORITIES },
    { key: "category", label: "Category", kind: "multiselect", options: "@categories" },
  ],
};
