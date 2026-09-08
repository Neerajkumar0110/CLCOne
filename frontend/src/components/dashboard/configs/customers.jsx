const STATUSES = ["Active", "On Hold", "Completed", "Dropped", "Deferred"];
const FEE_STATUSES = ["Paid", "Partial", "Unpaid", "Waived"];

export default {
  module: "customers",
  title: "Customers Analytics",
  subtitle: "Enrolled students as customers — fee realisation, retention and course value",
  businessTypeMode: "disabled",
  dateBasis: {
    default: "created",
    options: [
      { key: "created", label: "Created date" },
      { key: "enrolledOn", label: "Enrolled date" },
    ],
  },
  kpis: [
    { key: "total", label: "Students", fmt: "int" },
    { key: "active", label: "Active", fmt: "int", drill: { field: "status", op: "eq", value: "Active", label: "Active" } },
    { key: "completed", label: "Completed", fmt: "int", drill: { field: "status", op: "eq", value: "Completed", label: "Completed" } },
    { key: "dropped", label: "Dropped", fmt: "int", positiveWhenDown: true, drill: { field: "status", op: "eq", value: "Dropped", label: "Dropped" } },
    { key: "feePaid", label: "Fee Collected", fmt: "money" },
    { key: "feeOutstanding", label: "Fee Outstanding", fmt: "money", positiveWhenDown: true },
    { key: "avgFee", label: "Avg Fee / Student", fmt: "money" },
    { key: "feeRealisationPct", label: "Fee Realisation", fmt: "pct" },
  ],
  ratios: [
    { key: "feeRealisation", label: "Fee realisation" },
    { key: "retention", label: "Retention" },
    { key: "activePct", label: "Active %" },
  ],
  charts: [
    { key: "trend", title: "Enrolments Trend", kind: "area", span: 2 },
    { key: "feeByMonth", title: "Fee Collected vs Outstanding", kind: "stackedBar" },
    { key: "byCourse", title: "Students by Course", kind: "bar", onSegmentDrill: (i, label) => ({ field: "course", op: "eq", value: label, label: `Course: ${label}` }) },
    { key: "byStatus", title: "Students by Status", kind: "donut", onSegmentDrill: (i, label) => ({ field: "status", op: "eq", value: label, label: `Status: ${label}` }) },
    { key: "byCounsellor", title: "Students by Counsellor", kind: "bar", onSegmentDrill: (i, label) => ({ field: "counselor", op: "eq", value: label, label: `Counsellor: ${label}` }) },
  ],
  funnel: {
    title: "Fee Status",
    stages: FEE_STATUSES.map((s) => ({ key: s, label: s, drill: { field: "feeStatus", op: "eq", value: s, label: `Fee: ${s}` } })),
  },
  table: {
    mode: "client",
    columns: [
      { key: "name", label: "Customer", type: "text" },
      { key: "course", label: "Course", type: "text" },
      { key: "batch", label: "Batch", type: "text" },
      { key: "status", label: "Status", type: "badge" },
      { key: "feePaid", label: "Fee paid", type: "number" },
      { key: "feeTotal", label: "Fee total", type: "number" },
      { key: "feeStatus", label: "Fee status", type: "badge" },
      { key: "counselor", label: "Counsellor", type: "text" },
      { key: "enrolledOn", label: "Enrolled", type: "date" },
    ],
    rowActions: { view: true, edit: true, delete: false },
  },
  filterDrawer: [
    { key: "status", label: "Status", kind: "multiselect", options: STATUSES },
    { key: "course", label: "Course", kind: "multiselect", options: "@courses" },
    { key: "feeStatus", label: "Fee status", kind: "multiselect", options: FEE_STATUSES },
    { key: "counselor", label: "Counsellor", kind: "multiselect", options: "@counsellors" },
  ],
};
