export default {
  module: "overview",
  title: "Executive Overview",
  subtitle: "Company-wide pipeline, revenue and delivery at a glance",
  businessTypeMode: "team",
  kpis: [
    { key: "leads", label: "Total Leads", fmt: "int" },
    { key: "students", label: "New Students", fmt: "int" },
    { key: "connected", label: "Calls Connected", fmt: "int" },
    { key: "wonDeals", label: "Deals Won", fmt: "int" },
    { key: "revenue", label: "Revenue (paid)", fmt: "money" },
    { key: "pipelineValue", label: "Open Pipeline Value", fmt: "money" },
    { key: "orders", label: "Total Orders", fmt: "int" },
    { key: "lostDeals", label: "Lost Deals", fmt: "int", positiveWhenDown: true },
  ],
  ratios: [
    { key: "leadToEnrolled", label: "Lead → Enrolled" },
    { key: "callConnect", label: "Call connect" },
    { key: "dealWin", label: "Deal win" },
    { key: "quoteAcceptance", label: "Quote acceptance" },
    { key: "orderFulfilment", label: "Order fulfilment" },
  ],
  charts: [
    { key: "trend", title: "Activity Trend", kind: "line", span: 2 },
    { key: "revenueByMonth", title: "Revenue by Period", kind: "bar" },
    { key: "dealsByStage", title: "Deals by Stage", kind: "donut" },
    { key: "companyFunnel", title: "Company Funnel", kind: "bar" },
  ],
  funnel: {
    title: "Lead → Enrolment Funnel",
    stages: [
      { key: "new", label: "Leads", drill: { field: "stage", op: "eq", value: "New Lead", label: "New leads" } },
      { key: "contacted", label: "Contacted" },
      { key: "qualified", label: "Qualified" },
      { key: "meeting", label: "Meeting" },
      { key: "enrolled", label: "Enrolled", drill: { field: "stage", op: "eq", value: "Enrolled", label: "Enrolled" } },
    ],
  },
  table: {
    mode: "client",
    columns: [
      { key: "name", label: "Lead", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "source", label: "Source", type: "text" },
      { key: "stage", label: "Stage", type: "badge" },
      { key: "assignedUserName", label: "Owner", type: "text" },
      { key: "team", label: "Team", type: "text" },
      { key: "created", label: "Created", type: "date" },
    ],
    rowActions: { view: true, edit: "/sales/leads", delete: false },
  },
  filterDrawer: [
    { key: "source", label: "Lead source", kind: "multiselect", options: "@sources" },
    // Single-select, not multiselect: these two map straight onto the
    // backend's ?team=/?agent= narrowing (services/access/salesScope.js),
    // which only ever accepts one team / one person at a time. Only
    // Owner/Super Admin/Admin/Sales Manager/Team Manager actually get to use
    // them to narrow their company-wide view — everyone else is already
    // force-scoped server-side to their own team (or themselves), so picking
    // a value here is a no-op for them, not a way to see someone else's data.
    { key: "team", label: "Team", kind: "select", options: "@teams" },
    { key: "agent", label: "Person", kind: "select", options: "@agents" },
  ],
};
