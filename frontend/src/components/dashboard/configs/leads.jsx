const QUALIFIED = ["SUP Call", "Interested", "Sales Meeting", "Opportunity", "Enrolled"];
const MEETING = ["Sales Meeting", "Opportunity", "Enrolled"];
const STAGE_NAMES = [
  "New Lead", "Contacted", "SUP Call", "Fresh Lead", "Future Prospects", "Invalid",
  "Interested", "Sales Meeting", "Enrolled", "No Response", "Not Interested", "Call Back", "Opportunity",
];

export default {
  module: "leads",
  title: "Leads Analytics",
  subtitle: "Pipeline health, source quality and conversion for the sales desk",
  businessTypeMode: "team",
  dateBasis: {
    default: "created",
    options: [
      { key: "created", label: "Created date" },
      { key: "stageUpdatedAt", label: "Last stage change" },
    ],
  },
  kpis: [
    { key: "total", label: "Total Leads", fmt: "int" },
    { key: "qualified", label: "Qualified", fmt: "int", drill: { field: "stage", op: "in", value: QUALIFIED, label: "Qualified" } },
    { key: "contacted", label: "First Response", fmt: "int" },
    { key: "meetings", label: "Sales Meetings", fmt: "int", drill: { field: "stage", op: "in", value: MEETING, label: "Sales Meetings" } },
    { key: "enrolled", label: "Enrolled", fmt: "int", drill: { field: "stage", op: "eq", value: "Enrolled", label: "Enrolled" } },
    { key: "noResponse", label: "No Response", fmt: "int", positiveWhenDown: true, drill: { field: "stage", op: "eq", value: "No Response", label: "No Response" } },
    { key: "invalid", label: "Invalid / Junk", fmt: "int", positiveWhenDown: true, drill: { field: "stage", op: "eq", value: "Invalid", label: "Invalid" } },
    { key: "convPct", label: "Lead → Enrolled", fmt: "pct" },
  ],
  ratios: [
    { key: "leadQualification", label: "Qualification" },
    { key: "firstResponse", label: "First Response" },
    { key: "leadToSalesMeeting", label: "Lead → Meeting" },
    { key: "salesMeetingToEnrolled", label: "Meeting → Enrolled" },
    { key: "noResponseRate", label: "No Response", positiveWhenDown: true },
    { key: "leadToCalling", label: "Lead → Calling" },
  ],
  charts: [
    { key: "trend", title: "Lead Volume Trend", kind: "area", span: 2 },
    { key: "bySource", title: "Leads by Source", kind: "bar", onSegmentDrill: (i, label) => ({ field: "source", op: "eq", value: label, label: `Source: ${label}` }) },
    { key: "byStage", title: "Leads by Stage", kind: "bar", onSegmentDrill: (i, label) => ({ field: "stage", op: "eq", value: label, label: `Stage: ${label}` }) },
    { key: "byTeam", title: "Leads by Team", kind: "bar", onSegmentDrill: (i, label) => ({ field: "team", op: "eq", value: label, label: `Team: ${label}` }) },
    { key: "byOwner", title: "Leads by Owner", kind: "bar", onSegmentDrill: (i, label) => ({ field: "assignedUserName", op: "eq", value: label, label: `Owner: ${label}` }) },
  ],
  funnel: {
    title: "Conversion Funnel",
    stages: [
      { key: "new", label: "New", drill: { field: "stage", op: "eq", value: "New Lead", label: "New leads" } },
      { key: "contacted", label: "Contacted" },
      { key: "interested", label: "Interested", drill: { field: "stage", op: "eq", value: "Interested", label: "Interested" } },
      { key: "meeting", label: "Sales Meeting", drill: { field: "stage", op: "in", value: MEETING, label: "Sales meetings" } },
      { key: "opportunity", label: "Opportunity", drill: { field: "stage", op: "eq", value: "Opportunity", label: "Opportunity" } },
      { key: "enrolled", label: "Enrolled", drill: { field: "stage", op: "eq", value: "Enrolled", label: "Enrolled" } },
    ],
  },
  table: {
    mode: "server",
    columns: [
      { key: "name", label: "Name", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "source", label: "Source", type: "text" },
      { key: "stage", label: "Stage", type: "badge" },
      { key: "subStatus", label: "Sub-status", type: "text", defaultHidden: true },
      { key: "assignedUserName", label: "Owner", type: "text" },
      { key: "team", label: "Team", type: "text" },
      { key: "city", label: "City", type: "text", defaultHidden: true },
      { key: "created", label: "Created", type: "date" },
      { key: "nextFollowUpAt", label: "Next follow-up", type: "date" },
    ],
    rowActions: { view: true, edit: "/sales/leads", delete: false },
  },
  filterDrawer: [
    { key: "source", label: "Source", kind: "multiselect", options: "@sources" },
    { key: "stage", label: "Stage", kind: "multiselect", options: STAGE_NAMES },
    { key: "team", label: "Team", kind: "multiselect", options: "@teams" },
    { key: "owner", label: "Owner", kind: "multiselect", options: "@owners" },
    { key: "city", label: "City", kind: "text" },
    { key: "hasFollowUp", label: "Has pending follow-up", kind: "bool" },
  ],
};
