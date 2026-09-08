const STATUSES = ["Draft", "Pending Approval", "Sent", "Accepted", "Rejected", "Expired"];

export default {
  module: "quotes",
  title: "Quotes Analytics",
  subtitle: "Acceptance rates, quoted value and approval throughput",
  businessTypeMode: "derived",
  dateBasis: {
    default: "created",
    options: [
      { key: "created", label: "Created date" },
      { key: "issueDate", label: "Issue date" },
    ],
  },
  kpis: [
    { key: "total", label: "Total Quotes", fmt: "int" },
    { key: "sent", label: "Sent", fmt: "int", drill: { field: "status", op: "eq", value: "Sent", label: "Sent" } },
    { key: "accepted", label: "Accepted", fmt: "int", drill: { field: "status", op: "eq", value: "Accepted", label: "Accepted" } },
    { key: "rejected", label: "Rejected", fmt: "int", positiveWhenDown: true, drill: { field: "status", op: "eq", value: "Rejected", label: "Rejected" } },
    { key: "expired", label: "Expired", fmt: "int", positiveWhenDown: true, drill: { field: "status", op: "eq", value: "Expired", label: "Expired" } },
    { key: "pending", label: "Pending Approval", fmt: "int", drill: { field: "status", op: "eq", value: "Pending Approval", label: "Pending Approval" } },
    { key: "quotedValue", label: "Total Quoted Value", fmt: "money" },
    { key: "acceptedValue", label: "Accepted Value", fmt: "money" },
  ],
  ratios: [
    { key: "acceptanceRate", label: "Acceptance rate" },
    { key: "rejectionRate", label: "Rejection rate", positiveWhenDown: true },
    { key: "avgValue", label: "Avg quote value", fmt: "money" },
  ],
  charts: [
    { key: "trend", title: "Quotes Trend", kind: "line", span: 2 },
    { key: "byStatus", title: "Quotes by Status", kind: "donut", onSegmentDrill: (i, label) => ({ field: "status", op: "eq", value: label, label: `Status: ${label}` }) },
    { key: "valueByStatus", title: "Value by Status", kind: "bar" },
    { key: "byOwner", title: "Quotes by Owner", kind: "bar", onSegmentDrill: (i, label) => ({ field: "owner", op: "eq", value: label, label: `Owner: ${label}` }) },
  ],
  funnel: {
    title: "Quote Funnel",
    stages: [
      { key: "Draft", label: "Draft", drill: { field: "status", op: "eq", value: "Draft", label: "Draft" } },
      { key: "Pending Approval", label: "Pending Approval", drill: { field: "status", op: "eq", value: "Pending Approval", label: "Pending Approval" } },
      { key: "Sent", label: "Sent", drill: { field: "status", op: "eq", value: "Sent", label: "Sent" } },
      { key: "Accepted", label: "Accepted", drill: { field: "status", op: "eq", value: "Accepted", label: "Accepted" } },
    ],
  },
  table: {
    mode: "client",
    columns: [
      { key: "number", label: "Quote #", type: "text" },
      { key: "account", label: "Account", type: "text" },
      { key: "status", label: "Status", type: "badge" },
      { key: "total", label: "Total", type: "number" },
      { key: "discount", label: "Discount", type: "number", defaultHidden: true },
      { key: "owner", label: "Owner", type: "text" },
      { key: "issueDate", label: "Issued", type: "date" },
      { key: "validTill", label: "Valid till", type: "date" },
    ],
    rowActions: { view: true, edit: true, delete: true },
  },
  filterDrawer: [
    { key: "status", label: "Status", kind: "multiselect", options: STATUSES },
    { key: "owner", label: "Owner", kind: "multiselect", options: "@owners" },
    { key: "account", label: "Account", kind: "text" },
  ],
};
