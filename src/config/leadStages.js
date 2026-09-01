// Lead pipeline config — MUST stay in sync with
// backend/src/config/leadStages.js (same data).
//
// A lead has `stage` + `subStatus` (dependent dropdowns). `status` is a
// server-maintained mirror ("<stage> - <subStatus>") kept only for
// backward compatibility.

export const LEAD_STAGES = [
  {
    stage: "New Lead",
    color: "#2563EB",
    badgeClass: "hub-badge-blue",
    description: "Newly and freshly generated leads.",
    subStatuses: ["Newly Generated", "Freshly Generated"],
  },
  {
    stage: "Contacted",
    color: "#06B6D4",
    badgeClass: "hub-badge-blue",
    description: "First contact with the lead has been done.",
    subStatuses: ["First Contact Done"],
  },
  {
    stage: "SUP Call",
    color: "#8B5CF6",
    badgeClass: "hub-badge-purple",
    description: "Supervisor call required or completed.",
    subStatuses: ["Need Supervisor Call", "Supervisor Call Done"],
  },
  {
    stage: "Fresh Lead",
    color: "#22C55E",
    badgeClass: "hub-badge-green",
    description: "Fresh lead which is still being evaluated.",
    subStatuses: ["Fresh Lead"],
  },
  {
    stage: "Future Prospects",
    color: "#14B8A6",
    badgeClass: "hub-badge-blue",
    description: "Interested but planning to join within a future period.",
    subStatuses: ["Within 1 Month", "Within 2 Months", "Within 3 Months"],
    capture: "futureFollowUp",
  },
  {
    stage: "Invalid",
    color: "#94A3B8",
    badgeClass: "hub-badge-gray",
    description: "Lead is invalid or cannot be contacted.",
    subStatuses: ["Wrong Number", "Not in Service", "Incoming Not Available", "Did Not Enquire"],
  },
  {
    stage: "Interested",
    color: "#F97316",
    badgeClass: "hub-badge-yellow",
    description: "Lead has shown interest in the workshop / program.",
    subStatuses: ["Workshop Prospect", "Workshop Attended", "Post Workshop No Response"],
  },
  {
    stage: "Sales Meeting",
    color: "#6366F1",
    badgeClass: "hub-badge-purple",
    description: "Sales meeting lifecycle.",
    subStatuses: [
      "Meeting Scheduled",
      "Sales Meeting Done",
      "Sales Meeting Pending",
      "Sales Meeting Rescheduled",
    ],
    meetingSubStatuses: ["Meeting Scheduled", "Sales Meeting Rescheduled"],
  },
  {
    stage: "Enrolled",
    color: "#16A34A",
    badgeClass: "hub-badge-green",
    description: "Registration has been completed.",
    subStatuses: ["Registration Done"],
    capture: "enrolledAt",
  },
  {
    stage: "No Response",
    color: "#FB923C",
    badgeClass: "hub-badge-yellow",
    description: "Lead could not be reached.",
    subStatuses: ["Ringing", "No Response"],
  },
  {
    stage: "Not Interested",
    color: "#EF4444",
    badgeClass: "hub-badge-red",
    description: "Not interested due to a specific reason.",
    subStatuses: ["Price Too High", "Joined Somewhere Else", "No Money"],
  },
  {
    stage: "Call Back",
    color: "#EC4899",
    badgeClass: "hub-badge-purple",
    description: "Lead requested a callback. Date & time are mandatory.",
    subStatuses: ["Call Back Requested"],
    requiresCallBack: true,
  },
  {
    stage: "Opportunity",
    color: "#10B981",
    badgeClass: "hub-badge-green",
    description: "High-potential lead where the sales process has progressed.",
    subStatuses: ["Meeting Done", "Registration Link Shared"],
    linkSubStatuses: ["Registration Link Shared"],
  },
];

export const LEGACY_STATUS_MAP = {
  New: { stage: "New Lead", subStatus: "Newly Generated" },
  Contacted: { stage: "Contacted", subStatus: "First Contact Done" },
  Qualified: { stage: "Interested", subStatus: "Workshop Prospect" },
  Won: { stage: "Enrolled", subStatus: "Registration Done" },
  Lost: { stage: "Not Interested", subStatus: "Price Too High" },
};

export const STAGE_NAMES = LEAD_STAGES.map((s) => s.stage);

export const QUICK_FILTERS = [
  { key: "all", label: "All Leads" },
  { key: "new", label: "New Leads", stage: "New Lead" },
  { key: "contacted", label: "Contacted", stage: "Contacted" },
  { key: "interested", label: "Interested", stage: "Interested" },
  { key: "future", label: "Future Prospects", stage: "Future Prospects" },
  { key: "callback-today", label: "Call Back Today", quick: "callback-today" },
  { key: "callback-overdue", label: "Overdue Call Back", quick: "callback-overdue" },
  { key: "sales-meeting", label: "Sales Meeting", stage: "Sales Meeting" },
  { key: "opportunity", label: "Opportunity", stage: "Opportunity" },
  { key: "enrolled", label: "Enrolled", stage: "Enrolled" },
  { key: "not-interested", label: "Not Interested", stage: "Not Interested" },
  { key: "invalid", label: "Invalid", stage: "Invalid" },
];

const _stageByName = {};
LEAD_STAGES.forEach((s) => (_stageByName[s.stage] = s));

export function stageConfig(stage) {
  return _stageByName[stage] || null;
}

export function subStatusesFor(stage) {
  const cfg = _stageByName[stage];
  return cfg ? cfg.subStatuses : [];
}

export function defaultSubStatus(stage) {
  const cfg = _stageByName[stage];
  return cfg ? cfg.subStatuses[0] : "";
}

export function isValidSubStatus(stage, subStatus) {
  const cfg = _stageByName[stage];
  return !!cfg && cfg.subStatuses.includes(subStatus);
}

export function statusLabel(stage, subStatus) {
  if (!stage) return "";
  if (!subStatus || subStatus === stage) return stage;
  return `${stage} - ${subStatus}`;
}

// Any legacy / combined status string -> its stage name.
export function stageForStatus(status) {
  if (!status) return "New Lead";
  if (_stageByName[status]) return status;
  if (LEGACY_STATUS_MAP[status]) return LEGACY_STATUS_MAP[status].stage;
  const sep = status.indexOf(" - ");
  if (sep !== -1) {
    const prefix = status.slice(0, sep);
    if (_stageByName[prefix]) return prefix;
  }
  const owner = LEAD_STAGES.find((s) => s.subStatuses.includes(status));
  return owner ? owner.stage : "New Lead";
}

// Resolve a lead object (which may be pre-migration) to { stage, subStatus }.
export function leadStageSub(lead) {
  if (!lead) return { stage: "New Lead", subStatus: "Newly Generated" };
  let stage = lead.stage;
  let subStatus = lead.subStatus;
  if (!stage) {
    if (LEGACY_STATUS_MAP[lead.status]) {
      ({ stage, subStatus } = LEGACY_STATUS_MAP[lead.status]);
    } else {
      stage = stageForStatus(lead.status);
      const sep = (lead.status || "").indexOf(" - ");
      if (sep !== -1) subStatus = lead.status.slice(sep + 3);
    }
  }
  if (!_stageByName[stage]) stage = "New Lead";
  if (!isValidSubStatus(stage, subStatus)) subStatus = defaultSubStatus(stage);
  return { stage, subStatus };
}

export function badgeClassForStatus(statusOrStage) {
  const cfg = _stageByName[stageForStatus(statusOrStage)];
  return cfg ? cfg.badgeClass : "hub-badge-gray";
}

export function stageColor(stage) {
  const cfg = _stageByName[stage];
  return cfg ? cfg.color : "#94a3b8";
}

// <input type="datetime-local"> / date wants local-time strings.
export function toDatetimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
