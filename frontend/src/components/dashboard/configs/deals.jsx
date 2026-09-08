const OPEN = ["Qualification", "Needs Analysis", "Proposal", "Negotiation"];
const STAGES = [...OPEN, "Closed Won", "Closed Lost"];

export default {
  module: "deals",
  title: "Deals Analytics",
  subtitle: "Pipeline value, win rates and sales-cycle health",
  businessTypeMode: "derived",
  dateBasis: {
    default: "created",
    options: [
      { key: "created", label: "Created date" },
      { key: "closeDate", label: "Close date" },
    ],
  },
  kpis: [
    { key: "open", label: "Open Deals", fmt: "int", drill: { field: "stage", op: "in", value: OPEN, label: "Open deals" } },
    { key: "pipelineValue", label: "Pipeline Value", fmt: "money" },
    { key: "weightedValue", label: "Weighted Value", fmt: "money" },
    { key: "won", label: "Won Deals", fmt: "int", drill: { field: "stage", op: "eq", value: "Closed Won", label: "Won deals" } },
    { key: "wonValue", label: "Won Value", fmt: "money" },
    { key: "lost", label: "Lost Deals", fmt: "int", positiveWhenDown: true, drill: { field: "stage", op: "eq", value: "Closed Lost", label: "Lost deals" } },
    { key: "winRate", label: "Win Rate", fmt: "pct" },
    { key: "avgAge", label: "Avg Deal Age", fmt: "days" },
  ],
  ratios: [
    { key: "winRate", label: "Win rate" },
    { key: "lossRate", label: "Loss rate", positiveWhenDown: true },
    { key: "avgCycle", label: "Avg cycle", fmt: "days" },
    { key: "negToWon", label: "Negotiation → Won" },
  ],
  charts: [
    { key: "trend", title: "Deals Created vs Won", kind: "line", span: 2 },
    { key: "pipelineByStage", title: "Pipeline Value by Stage", kind: "bar", onSegmentDrill: (i, label) => ({ field: "stage", op: "eq", value: label, label: `Stage: ${label}` }) },
    { key: "bySource", title: "Deals by Source", kind: "bar", onSegmentDrill: (i, label) => ({ field: "source", op: "eq", value: label, label: `Source: ${label}` }) },
    { key: "byOwner", title: "Deals by Owner", kind: "bar", onSegmentDrill: (i, label) => ({ field: "owner", op: "eq", value: label, label: `Owner: ${label}` }) },
    { key: "lossReasons", title: "Loss Reasons", kind: "bar" },
  ],
  funnel: {
    title: "Deal Funnel",
    stages: [
      { key: "Qualification", label: "Qualification", drill: { field: "stage", op: "eq", value: "Qualification", label: "Qualification" } },
      { key: "Needs Analysis", label: "Needs Analysis", drill: { field: "stage", op: "eq", value: "Needs Analysis", label: "Needs Analysis" } },
      { key: "Proposal", label: "Proposal", drill: { field: "stage", op: "eq", value: "Proposal", label: "Proposal" } },
      { key: "Negotiation", label: "Negotiation", drill: { field: "stage", op: "eq", value: "Negotiation", label: "Negotiation" } },
      { key: "Closed Won", label: "Closed Won", drill: { field: "stage", op: "eq", value: "Closed Won", label: "Closed Won" } },
    ],
  },
  table: {
    mode: "client",
    columns: [
      { key: "title", label: "Deal", type: "text" },
      { key: "account", label: "Account", type: "text" },
      { key: "stage", label: "Stage", type: "badge" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "probability", label: "Prob %", type: "number" },
      { key: "owner", label: "Owner", type: "text" },
      { key: "source", label: "Source", type: "text" },
      { key: "closeDate", label: "Close date", type: "date" },
      { key: "ageDays", label: "Age (d)", type: "number" },
      { key: "lossReason", label: "Loss reason", type: "text", defaultHidden: true },
    ],
    rowActions: { view: true, edit: true, delete: true },
  },
  filterDrawer: [
    { key: "stage", label: "Stage", kind: "multiselect", options: STAGES },
    { key: "source", label: "Source", kind: "multiselect", options: "@sources" },
    { key: "owner", label: "Owner", kind: "multiselect", options: "@owners" },
    { key: "minAmount", label: "Min amount", kind: "number" },
  ],
};
