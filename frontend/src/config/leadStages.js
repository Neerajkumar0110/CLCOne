// Lead pipeline config — MUST stay in sync with
// backend/src/config/leadStages.js (same data).
//
// A lead has `stage` + `subStatus` (dependent dropdowns). `status` is a
// server-maintained mirror ("<stage> - <subStatus>") kept only for
// backward compatibility.
//
// Replaced 2026-10 — see backend/src/config/leadStages.js's header comment
// for the previous 13-stage taxonomy and the LEGACY_STAGE_MAP this one
// replaced it with (every stored Lead was migrated, see
// scripts/migrateLeadStagesToV2.cjs).

export const LEAD_STAGES = [
  {
    stage: "New Lead",
    color: "#2563EB",
    badgeClass: "hub-badge-blue",
    description: "Fresh lead, just handed to a BDE.",
    subStatuses: ["Assigned to BDE After Connecting with Candidate (By Auto Dialer)"],
  },
  {
    stage: "Fresh Leads",
    color: "#22C55E",
    badgeClass: "hub-badge-green",
    description: "Old lead being redialed / reassigned for another pass.",
    subStatuses: ["Old Leads reassignment or Stage wise Dialing"],
  },
  {
    stage: "Invalid Leads",
    color: "#94A3B8",
    badgeClass: "hub-badge-gray",
    description: "Number or enquiry turned out to be invalid.",
    subStatuses: [
      "Incoming Not Available",
      "Invalid Number",
      "Number not in Service",
      "Wrong Number",
      "Did not Inquire",
      "Language Barrier",
    ],
  },
  {
    stage: "No Response",
    color: "#FB923C",
    badgeClass: "hub-badge-yellow",
    description: "Lead could not be reached on this attempt.",
    subStatuses: ["Switch off", "Not Reachable", "Ringing"],
  },
  {
    stage: "Callback",
    color: "#EC4899",
    badgeClass: "hub-badge-purple",
    description: "Lead asked to be called back at a specific date & time (mandatory).",
    subStatuses: ["Call back (Custom Date & Time)"],
    requiresCallBack: true,
  },
  {
    stage: "Connected Leads",
    color: "#06B6D4",
    badgeClass: "hub-badge-blue",
    description: "First real discussion has happened.",
    subStatuses: ["1st Discussion Done - Qualified", "1st Discussion Done - Non Qualified"],
  },
  {
    stage: "Demo Booking",
    color: "#6366F1",
    badgeClass: "hub-badge-purple",
    description: "Demo lifecycle — booked, attended or missed.",
    subStatuses: ["Demo Booked", "Demo Attended", "Demo Not Attended"],
    meetingSubStatuses: ["Demo Booked"],
  },
  {
    stage: "Interested Leads",
    color: "#F97316",
    badgeClass: "hub-badge-yellow",
    description: "Lead is engaged — support call done or scholarship test given.",
    subStatuses: ["Supp Call Done", "Scholarship Test Given"],
  },
  {
    stage: "Prospects",
    color: "#10B981",
    badgeClass: "hub-badge-green",
    description: "High-potential lead, an active opportunity.",
    subStatuses: ["Opportunities"],
  },
  {
    stage: "Future Prospect",
    color: "#14B8A6",
    badgeClass: "hub-badge-blue",
    description: "Interested but only planning to join after some time.",
    subStatuses: ["After 15 Days", "After 1 month", "After 2 months"],
    capture: "futureFollowUp",
  },
  {
    stage: "Not Interested Leads",
    color: "#EF4444",
    badgeClass: "hub-badge-red",
    description: "Lead is not interested, with a specific reason.",
    subStatuses: [
      "Not Interested for Demo",
      "Did not liked the Demo",
      "Sales Staff Behaviour Issue",
      "Price Too High",
      "Joined Somewhere else",
      "Looking for Job Only",
      "Plan Dropped",
      "Pay After Placement",
      "Looking for Offline",
      "Reason Not Clear",
    ],
  },
  {
    stage: "Enrolled",
    color: "#16A34A",
    badgeClass: "hub-badge-green",
    description: "Registration completed.",
    subStatuses: [
      "Foundation Registration Done - No Cost EMI",
      "Foundation Registration Done - Credit Card",
      "Foundation Registration Done - One Time Payment",
      "Foundation Registration Done - Self EMI",
      "Elite Registration Done - No Cost EMI",
      "Elite Registration Done - Credit Card",
      "Elite Registration Done - One Time Payment",
      "Elite Registration Done - Self EMI",
    ],
    capture: "enrolledAt",
  },
];

// Old (pre-2026-10) stage name -> today's { stage, subStatus } default, with
// an optional per-old-subStatus override (`subMap`). Mirrors the backend's
// LEGACY_STAGE_MAP exactly — used by leadStageSub() below so a lead that
// somehow still carries an old stage name renders sensibly instead of
// falling through to a blank "New Lead".
export const LEGACY_STAGE_MAP = {
  "New Lead": {
    stage: "New Lead",
    subStatus: "Assigned to BDE After Connecting with Candidate (By Auto Dialer)",
  },
  Contacted: { stage: "Connected Leads", subStatus: "1st Discussion Done - Qualified" },
  "SUP Call": { stage: "Interested Leads", subStatus: "Supp Call Done" },
  "Fresh Lead": { stage: "Fresh Leads", subStatus: "Old Leads reassignment or Stage wise Dialing" },
  "Future Prospects": {
    stage: "Future Prospect",
    subStatus: "After 2 months",
    subMap: { "Within 1 Month": "After 15 Days", "Within 2 Months": "After 1 month", "Within 3 Months": "After 2 months" },
  },
  Invalid: {
    stage: "Invalid Leads",
    subStatus: "Did not Inquire",
    subMap: {
      "Wrong Number": "Wrong Number",
      "Not in Service": "Number not in Service",
      "Incoming Not Available": "Incoming Not Available",
      "Did Not Enquire": "Did not Inquire",
    },
  },
  Interested: {
    stage: "Demo Booking",
    subStatus: "Demo Booked",
    subMap: {
      "Workshop Prospect": "Demo Booked",
      "Workshop Attended": "Demo Attended",
      "Post Workshop No Response": "Demo Not Attended",
    },
  },
  "Sales Meeting": {
    stage: "Demo Booking",
    subStatus: "Demo Booked",
    subMap: {
      "Meeting Scheduled": "Demo Booked",
      "Sales Meeting Done": "Demo Attended",
      "Sales Meeting Pending": "Demo Booked",
      "Sales Meeting Rescheduled": "Demo Booked",
    },
  },
  Enrolled: { stage: "Enrolled", subStatus: "Foundation Registration Done - One Time Payment" },
  "No Response": {
    stage: "No Response",
    subStatus: "Not Reachable",
    subMap: { Ringing: "Ringing", "No Response": "Not Reachable" },
  },
  "Not Interested": {
    stage: "Not Interested Leads",
    subStatus: "Reason Not Clear",
    subMap: {
      "Price Too High": "Price Too High",
      "Joined Somewhere Else": "Joined Somewhere else",
      "No Money": "Reason Not Clear",
    },
  },
  "Call Back": { stage: "Callback", subStatus: "Call back (Custom Date & Time)" },
  Opportunity: { stage: "Prospects", subStatus: "Opportunities" },
};

export const LEGACY_STATUS_MAP = {
  New: { stage: "New Lead", subStatus: "Assigned to BDE After Connecting with Candidate (By Auto Dialer)" },
  Contacted: { stage: "Connected Leads", subStatus: "1st Discussion Done - Qualified" },
  Qualified: { stage: "Demo Booking", subStatus: "Demo Booked" },
  Won: { stage: "Enrolled", subStatus: "Foundation Registration Done - One Time Payment" },
  Lost: { stage: "Not Interested Leads", subStatus: "Reason Not Clear" },
};

export const STAGE_NAMES = LEAD_STAGES.map((s) => s.stage);

export const QUICK_FILTERS = [
  { key: "all", label: "All Leads" },
  { key: "new", label: "New Leads", stage: "New Lead" },
  { key: "fresh", label: "Fresh Leads", stage: "Fresh Leads" },
  { key: "connected", label: "Connected Leads", stage: "Connected Leads" },
  { key: "interested", label: "Interested Leads", stage: "Interested Leads" },
  { key: "future", label: "Future Prospect", stage: "Future Prospect" },
  { key: "callback-today", label: "Call Back Today", quick: "callback-today" },
  { key: "callback-overdue", label: "Overdue Call Back", quick: "callback-overdue" },
  { key: "demo-booking", label: "Demo Booking", stage: "Demo Booking" },
  { key: "prospects", label: "Prospects", stage: "Prospects" },
  { key: "enrolled", label: "Enrolled", stage: "Enrolled" },
  { key: "not-interested", label: "Not Interested", stage: "Not Interested Leads" },
  { key: "invalid", label: "Invalid", stage: "Invalid Leads" },
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

// An old (pre-2026-10) stage name -> today's { stage, subStatus }, or null.
export function resolveLegacyStage(rawStage, rawSub) {
  const hit = LEGACY_STAGE_MAP[rawStage];
  if (!hit) return null;
  const subStatus = (hit.subMap && hit.subMap[rawSub]) || hit.subStatus;
  return { stage: hit.stage, subStatus };
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
    const legacyHit = resolveLegacyStage(prefix, status.slice(sep + 3));
    if (legacyHit) return legacyHit.stage;
  }
  if (LEGACY_STAGE_MAP[status]) return LEGACY_STAGE_MAP[status].stage;
  const owner = LEAD_STAGES.find((s) => s.subStatuses.includes(status));
  return owner ? owner.stage : "New Lead";
}

// Resolve a lead object (which may be pre-migration) to { stage, subStatus }.
export function leadStageSub(lead) {
  if (!lead) return { stage: "New Lead", subStatus: defaultSubStatus("New Lead") };
  let stage = lead.stage;
  let subStatus = lead.subStatus;
  if (stage && !_stageByName[stage]) {
    const legacyHit = resolveLegacyStage(stage, subStatus);
    if (legacyHit) {
      stage = legacyHit.stage;
      subStatus = legacyHit.subStatus;
    }
  }
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
