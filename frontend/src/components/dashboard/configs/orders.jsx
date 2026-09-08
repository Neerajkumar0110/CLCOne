const STATUSES = ["Draft", "Confirmed", "Processing", "Fulfilled", "Partially Fulfilled", "Invoiced", "Cancelled"];
const PAY = ["Unpaid", "Partial", "Paid"];

export default {
  module: "orders",
  title: "Orders Analytics",
  subtitle: "Order value, fulfilment and payment realisation",
  businessTypeMode: "derived",
  dateBasis: {
    default: "created",
    options: [
      { key: "created", label: "Created date" },
      { key: "orderDate", label: "Order date" },
    ],
  },
  kpis: [
    { key: "total", label: "Total Orders", fmt: "int" },
    { key: "orderValue", label: "Order Value", fmt: "money" },
    { key: "confirmedProcessing", label: "Confirmed + Processing", fmt: "int" },
    { key: "fulfilled", label: "Fulfilled + Invoiced", fmt: "int" },
    { key: "cancelled", label: "Cancelled", fmt: "int", positiveWhenDown: true, drill: { field: "status", op: "eq", value: "Cancelled", label: "Cancelled" } },
    { key: "unpaidValue", label: "Unpaid Value", fmt: "money", positiveWhenDown: true },
    { key: "paidValue", label: "Paid Value", fmt: "money" },
    { key: "avgOrderValue", label: "Avg Order Value", fmt: "money" },
  ],
  ratios: [
    { key: "fulfilmentRate", label: "Fulfilment rate" },
    { key: "cancellationRate", label: "Cancellation rate", positiveWhenDown: true },
    { key: "paymentRealisation", label: "Payment realisation" },
    { key: "onTimeRate", label: "On-time delivery" },
  ],
  charts: [
    { key: "trend", title: "Orders & Value Trend", kind: "line", span: 2 },
    { key: "byStatus", title: "Orders by Status", kind: "donut", onSegmentDrill: (i, label) => ({ field: "status", op: "eq", value: label, label: `Status: ${label}` }) },
    { key: "byPaymentStatus", title: "Orders by Payment Status", kind: "bar", onSegmentDrill: (i, label) => ({ field: "paymentStatus", op: "eq", value: label, label: `Payment: ${label}` }) },
    { key: "valueByMonth", title: "Order Value by Period", kind: "bar" },
    { key: "byOwner", title: "Orders by Owner", kind: "bar", onSegmentDrill: (i, label) => ({ field: "owner", op: "eq", value: label, label: `Owner: ${label}` }) },
  ],
  funnel: {
    title: "Order Funnel",
    stages: [
      { key: "Draft", label: "Draft", drill: { field: "status", op: "eq", value: "Draft", label: "Draft" } },
      { key: "Confirmed", label: "Confirmed", drill: { field: "status", op: "eq", value: "Confirmed", label: "Confirmed" } },
      { key: "Processing", label: "Processing", drill: { field: "status", op: "eq", value: "Processing", label: "Processing" } },
      { key: "Fulfilled", label: "Fulfilled", drill: { field: "status", op: "eq", value: "Fulfilled", label: "Fulfilled" } },
      { key: "Invoiced", label: "Invoiced", drill: { field: "status", op: "eq", value: "Invoiced", label: "Invoiced" } },
    ],
  },
  table: {
    mode: "client",
    columns: [
      { key: "number", label: "Order #", type: "text" },
      { key: "account", label: "Account", type: "text" },
      { key: "status", label: "Status", type: "badge" },
      { key: "total", label: "Total", type: "number" },
      { key: "paymentStatus", label: "Payment", type: "badge" },
      { key: "orderDate", label: "Ordered", type: "date" },
      { key: "expectedDelivery", label: "Expected", type: "date" },
      { key: "deliveredDate", label: "Delivered", type: "date" },
      { key: "owner", label: "Owner", type: "text", defaultHidden: true },
    ],
    rowActions: { view: true, edit: true, delete: true },
  },
  filterDrawer: [
    { key: "status", label: "Status", kind: "multiselect", options: STATUSES },
    { key: "paymentStatus", label: "Payment status", kind: "multiselect", options: PAY },
    { key: "owner", label: "Owner", kind: "multiselect", options: "@owners" },
    { key: "account", label: "Account", kind: "text" },
  ],
};
