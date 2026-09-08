const STATUSES = ["Active", "On Hold", "Completed", "Dropped", "Deferred"];

export default {
  module: "interns",
  title: "Interns Analytics",
  subtitle: "Progress, attendance and completion across internship cohorts",
  businessTypeMode: "disabled",
  dateBasis: {
    default: "created",
    options: [
      { key: "created", label: "Created date" },
      { key: "enrolledOn", label: "Start date" },
    ],
  },
  kpis: [
    { key: "total", label: "Total Interns", fmt: "int" },
    { key: "active", label: "Active", fmt: "int", drill: { field: "status", op: "eq", value: "Active", label: "Active" } },
    { key: "completed", label: "Completed", fmt: "int", drill: { field: "status", op: "eq", value: "Completed", label: "Completed" } },
    { key: "dropped", label: "Dropped", fmt: "int", positiveWhenDown: true, drill: { field: "status", op: "eq", value: "Dropped", label: "Dropped" } },
    { key: "avgProgress", label: "Avg Progress", fmt: "pct" },
    { key: "avgAttendance", label: "Avg Attendance", fmt: "pct" },
    { key: "avgScore", label: "Avg Score", fmt: "int" },
    { key: "onHoldDeferred", label: "On Hold + Deferred", fmt: "int", positiveWhenDown: true },
  ],
  ratios: [
    { key: "completionRate", label: "Completion rate" },
    { key: "dropRate", label: "Drop rate", positiveWhenDown: true },
    { key: "attendancePct", label: "Attendance %" },
    { key: "avgProgressPct", label: "Avg progress %" },
  ],
  charts: [
    { key: "trend", title: "Interns Onboarded", kind: "area", span: 2 },
    { key: "byStatus", title: "Interns by Status", kind: "donut", onSegmentDrill: (i, label) => ({ field: "status", op: "eq", value: label, label: `Status: ${label}` }) },
    { key: "byCourse", title: "Interns by Course", kind: "bar", onSegmentDrill: (i, label) => ({ field: "course", op: "eq", value: label, label: `Course: ${label}` }) },
    { key: "byBatch", title: "Interns by Batch", kind: "bar", onSegmentDrill: (i, label) => ({ field: "batch", op: "eq", value: label, label: `Batch: ${label}` }) },
    { key: "progressDist", title: "Progress Distribution", kind: "bar" },
    { key: "attendanceDist", title: "Attendance Distribution", kind: "bar" },
  ],
  funnel: {
    title: "Internship Funnel",
    stages: [
      { key: "enrolled", label: "Enrolled" },
      { key: "active", label: "Active", drill: { field: "status", op: "eq", value: "Active", label: "Active" } },
      { key: "half", label: "Progress ≥ 50%", drill: { field: "progress", op: "gte", value: 50, label: "Progress ≥ 50%" } },
      { key: "completed", label: "Completed", drill: { field: "status", op: "eq", value: "Completed", label: "Completed" } },
    ],
  },
  table: {
    mode: "client",
    columns: [
      { key: "name", label: "Intern", type: "text" },
      { key: "course", label: "Course", type: "text" },
      { key: "batch", label: "Batch", type: "text" },
      { key: "status", label: "Status", type: "badge" },
      { key: "progress", label: "Progress %", type: "number" },
      { key: "attendancePct", label: "Attendance %", type: "number" },
      { key: "avgScore", label: "Avg score", type: "number" },
      { key: "enrolledOn", label: "Start date", type: "date" },
    ],
    rowActions: { view: true, edit: true, delete: false },
  },
  filterDrawer: [
    { key: "status", label: "Status", kind: "multiselect", options: STATUSES },
    { key: "course", label: "Course", kind: "multiselect", options: "@courses" },
    { key: "batch", label: "Batch", kind: "multiselect", options: "@batches" },
  ],
};
