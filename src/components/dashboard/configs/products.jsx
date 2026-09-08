const TYPES = ["Service", "Physical", "Digital", "Subscription"];
const STATUSES = ["Active", "Inactive", "Discontinued"];

export default {
  module: "products",
  title: "Products Analytics",
  subtitle: "Catalog health, stock position and margin",
  businessTypeMode: "disabled",
  kpis: [
    { key: "total", label: "Total Products", fmt: "int" },
    { key: "active", label: "Active", fmt: "int", drill: { field: "status", op: "eq", value: "Active", label: "Active" } },
    { key: "dead", label: "Inactive + Discontinued", fmt: "int", positiveWhenDown: true },
    { key: "lowStock", label: "Low Stock", fmt: "int", positiveWhenDown: true },
    { key: "outOfStock", label: "Out of Stock", fmt: "int", positiveWhenDown: true, drill: { field: "stockQty", op: "eq", value: 0, label: "Out of stock" } },
    { key: "avgUnitPrice", label: "Avg Unit Price", fmt: "money" },
    { key: "catalogValue", label: "Catalog Value", fmt: "money" },
    { key: "avgMargin", label: "Avg Margin", fmt: "pct" },
  ],
  ratios: [
    { key: "activePct", label: "Active %" },
    { key: "lowStockPct", label: "Low-stock %", positiveWhenDown: true },
    { key: "avgMarginPct", label: "Avg margin %" },
    { key: "subscriptionShare", label: "Subscription share" },
  ],
  charts: [
    { key: "byCategory", title: "Products by Category", kind: "bar", span: 2, onSegmentDrill: (i, label) => ({ field: "category", op: "eq", value: label, label: `Category: ${label}` }) },
    { key: "byType", title: "Products by Type", kind: "donut", onSegmentDrill: (i, label) => ({ field: "type", op: "eq", value: label, label: `Type: ${label}` }) },
    { key: "byStatus", title: "Products by Status", kind: "bar", onSegmentDrill: (i, label) => ({ field: "status", op: "eq", value: label, label: `Status: ${label}` }) },
    { key: "priceDistribution", title: "Price Distribution", kind: "bar" },
    { key: "marginByCategory", title: "Margin % by Category", kind: "bar" },
  ],
  funnel: {
    title: "Catalog Health",
    stages: [
      { key: "active", label: "Active", drill: { field: "status", op: "eq", value: "Active", label: "Active" } },
      { key: "inactive", label: "Inactive", drill: { field: "status", op: "eq", value: "Inactive", label: "Inactive" } },
      { key: "discontinued", label: "Discontinued", drill: { field: "status", op: "eq", value: "Discontinued", label: "Discontinued" } },
      { key: "low", label: "Low stock" },
    ],
  },
  table: {
    mode: "client",
    columns: [
      { key: "name", label: "Product", type: "text" },
      { key: "sku", label: "SKU", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "type", label: "Type", type: "badge" },
      { key: "status", label: "Status", type: "badge" },
      { key: "unitPrice", label: "Unit price", type: "number" },
      { key: "costPrice", label: "Cost price", type: "number", defaultHidden: true },
      { key: "stockQty", label: "Stock", type: "number" },
      { key: "reorderLevel", label: "Reorder at", type: "number", defaultHidden: true },
      { key: "marginPct", label: "Margin %", type: "number" },
    ],
    rowActions: { view: true, edit: true, delete: true },
  },
  filterDrawer: [
    { key: "category", label: "Category", kind: "multiselect", options: "@categories" },
    { key: "type", label: "Type", kind: "multiselect", options: TYPES },
    { key: "status", label: "Status", kind: "multiselect", options: STATUSES },
  ],
};
