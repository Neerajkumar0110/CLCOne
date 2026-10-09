// ─────────────────────────────────────────────────────────────────────────
// Lead pipeline: 12 stages, each with its own dependent sub-status list.
// This file is the single source of truth for both backend and frontend
// (frontend/src/config/leadStages.js is a generated-by-hand ESM mirror —
// keep the two in sync).
//
// A lead carries BOTH `stage` and `subStatus`. `status` is a denormalised
// convenience mirror ("<stage> - <subStatus>", or just "<stage>" when the
// sub-status repeats the stage name) kept in sync by a Lead pre-save /
// pre-findOneAndUpdate hook, so every place in the app that still reads
// `lead.status` keeps working unchanged.
//
// Replaced 2026-10 — the previous 13-stage taxonomy (New Lead/Contacted/SUP
// Call/Fresh Lead/Future Prospects/Invalid/Interested/Sales Meeting/
// Enrolled/No Response/Not Interested/Call Back/Opportunity) is retired in
// favour of this one. LEGACY_STAGE_MAP below is how every already-stored
// Lead document's old stage/subStatus gets carried forward — see
// scripts/migrateLeadStagesToV2.cjs, which rewrote every Lead in prod to the
// new values using exactly this map (run once; this map stays for any lead
// still holding an old value some other way, e.g. a stale import).
// ─────────────────────────────────────────────────────────────────────────

const LEAD_STAGES = [
  {
    stage: 'New Lead',
    color: '#2563EB',
    badgeClass: 'hub-badge-blue',
    description: 'Fresh lead, just handed to a BDE.',
    subStatuses: ['Assigned to BDE After Connecting with Candidate (By Auto Dialer)'],
  },
  {
    stage: 'Fresh Leads',
    color: '#22C55E',
    badgeClass: 'hub-badge-green',
    description: 'Old lead being redialed / reassigned for another pass.',
    subStatuses: ['Old Leads reassignment or Stage wise Dialing'],
  },
  {
    stage: 'Invalid Leads',
    color: '#94A3B8',
    badgeClass: 'hub-badge-gray',
    description: 'Number or enquiry turned out to be invalid.',
    subStatuses: [
      'Incoming Not Available',
      'Invalid Number',
      'Number not in Service',
      'Wrong Number',
      'Did not Inquire',
      'Language Barrier',
    ],
  },
  {
    stage: 'No Response',
    color: '#FB923C',
    badgeClass: 'hub-badge-yellow',
    description: 'Lead could not be reached on this attempt.',
    subStatuses: ['Switch off', 'Not Reachable', 'Ringing'],
  },
  {
    stage: 'Callback',
    color: '#EC4899',
    badgeClass: 'hub-badge-purple',
    description: 'Lead asked to be called back at a specific date & time (mandatory).',
    subStatuses: ['Call back (Custom Date & Time)'],
    requiresCallBack: true,
  },
  {
    stage: 'Connected Leads',
    color: '#06B6D4',
    badgeClass: 'hub-badge-blue',
    description: 'First real discussion has happened.',
    subStatuses: ['1st Discussion Done - Qualified', '1st Discussion Done - Non Qualified'],
  },
  {
    stage: 'Demo Booking',
    color: '#6366F1',
    badgeClass: 'hub-badge-purple',
    description: 'Demo lifecycle — booked, attended or missed.',
    subStatuses: ['Demo Booked', 'Demo Attended', 'Demo Not Attended'],
    // Booking one asks for a demo date/time (reuses the same meetingAt capture
    // the old "Sales Meeting" stage used).
    meetingSubStatuses: ['Demo Booked'],
  },
  {
    stage: 'Interested Leads',
    color: '#F97316',
    badgeClass: 'hub-badge-yellow',
    description: 'Lead is engaged — support call done or scholarship test given.',
    subStatuses: ['Supp Call Done', 'Scholarship Test Given'],
  },
  {
    stage: 'Prospects',
    color: '#10B981',
    badgeClass: 'hub-badge-green',
    description: 'High-potential lead, an active opportunity.',
    subStatuses: ['Opportunities'],
  },
  {
    stage: 'Future Prospect',
    color: '#14B8A6',
    badgeClass: 'hub-badge-blue',
    description: 'Interested but only planning to join after some time.',
    subStatuses: ['After 15 Days', 'After 1 month', 'After 2 months'],
    // Any sub-status here asks for an expected follow-up date.
    capture: 'futureFollowUp',
  },
  {
    stage: 'Not Interested Leads',
    color: '#EF4444',
    badgeClass: 'hub-badge-red',
    description: 'Lead is not interested, with a specific reason.',
    subStatuses: [
      'Not Interested for Demo',
      'Did not liked the Demo',
      'Sales Staff Behaviour Issue',
      'Price Too High',
      'Joined Somewhere else',
      'Looking for Job Only',
      'Plan Dropped',
      'Pay After Placement',
      'Looking for Offline',
      'Reason Not Clear',
    ],
  },
  {
    stage: 'Enrolled',
    color: '#16A34A',
    badgeClass: 'hub-badge-green',
    description: 'Registration completed.',
    subStatuses: [
      'Foundation Registration Done - No Cost EMI',
      'Foundation Registration Done - Credit Card',
      'Foundation Registration Done - One Time Payment',
      'Foundation Registration Done - Self EMI',
      'Elite Registration Done - No Cost EMI',
      'Elite Registration Done - Credit Card',
      'Elite Registration Done - One Time Payment',
      'Elite Registration Done - Self EMI',
    ],
    capture: 'enrolledAt',
  },
];

// Old (pre-2026-10) stage name -> new { stage, subStatus } default, with an
// optional per-old-subStatus override (`subMap`) for a tighter match. Used
// by resolveStageSub's legacy fallback below AND by the one-off migration
// script that rewrote every stored Lead document.
const LEGACY_STAGE_MAP = {
  'New Lead': {
    stage: 'New Lead',
    subStatus: 'Assigned to BDE After Connecting with Candidate (By Auto Dialer)',
  },
  Contacted: {
    stage: 'Connected Leads',
    subStatus: '1st Discussion Done - Qualified',
  },
  'SUP Call': {
    stage: 'Interested Leads',
    subStatus: 'Supp Call Done',
  },
  'Fresh Lead': {
    stage: 'Fresh Leads',
    subStatus: 'Old Leads reassignment or Stage wise Dialing',
  },
  'Future Prospects': {
    stage: 'Future Prospect',
    subStatus: 'After 2 months',
    subMap: {
      'Within 1 Month': 'After 15 Days',
      'Within 2 Months': 'After 1 month',
      'Within 3 Months': 'After 2 months',
    },
  },
  Invalid: {
    stage: 'Invalid Leads',
    subStatus: 'Did not Inquire',
    subMap: {
      'Wrong Number': 'Wrong Number',
      'Not in Service': 'Number not in Service',
      'Incoming Not Available': 'Incoming Not Available',
      'Did Not Enquire': 'Did not Inquire',
    },
  },
  Interested: {
    stage: 'Demo Booking',
    subStatus: 'Demo Booked',
    subMap: {
      'Workshop Prospect': 'Demo Booked',
      'Workshop Attended': 'Demo Attended',
      'Post Workshop No Response': 'Demo Not Attended',
    },
  },
  'Sales Meeting': {
    stage: 'Demo Booking',
    subStatus: 'Demo Booked',
    subMap: {
      'Meeting Scheduled': 'Demo Booked',
      'Sales Meeting Done': 'Demo Attended',
      'Sales Meeting Pending': 'Demo Booked',
      'Sales Meeting Rescheduled': 'Demo Booked',
    },
  },
  Enrolled: {
    stage: 'Enrolled',
    subStatus: 'Foundation Registration Done - One Time Payment',
  },
  'No Response': {
    stage: 'No Response',
    subStatus: 'Not Reachable',
    subMap: {
      Ringing: 'Ringing',
      'No Response': 'Not Reachable',
    },
  },
  'Not Interested': {
    stage: 'Not Interested Leads',
    subStatus: 'Reason Not Clear',
    subMap: {
      'Price Too High': 'Price Too High',
      'Joined Somewhere Else': 'Joined Somewhere else',
      'No Money': 'Reason Not Clear',
    },
  },
  'Call Back': {
    stage: 'Callback',
    subStatus: 'Call back (Custom Date & Time)',
  },
  Opportunity: {
    stage: 'Prospects',
    subStatus: 'Opportunities',
  },
};

// Even-older flat 5-value status ("New"/"Contacted"/"Qualified"/"Won"/
// "Lost") -> { stage, subStatus } in the current model. Used by
// resolveStageSub's fallback and as a read-time safety net.
const LEGACY_STATUS_MAP = {
  New: { stage: 'New Lead', subStatus: 'Assigned to BDE After Connecting with Candidate (By Auto Dialer)' },
  Contacted: { stage: 'Connected Leads', subStatus: '1st Discussion Done - Qualified' },
  Qualified: { stage: 'Demo Booking', subStatus: 'Demo Booked' },
  Won: { stage: 'Enrolled', subStatus: 'Foundation Registration Done - One Time Payment' },
  Lost: { stage: 'Not Interested Leads', subStatus: 'Reason Not Clear' },
};

const STAGE_NAMES = LEAD_STAGES.map((s) => s.stage);
const SUB_STATUSES_BY_STAGE = {};
LEAD_STAGES.forEach((s) => (SUB_STATUSES_BY_STAGE[s.stage] = s.subStatuses));
const ALL_SUB_STATUSES = [...new Set(LEAD_STAGES.flatMap((s) => s.subStatuses))];

function stageConfig(stage) {
  return LEAD_STAGES.find((s) => s.stage === stage) || null;
}

function isValidStage(stage) {
  return STAGE_NAMES.includes(stage);
}

function isValidSubStatus(stage, subStatus) {
  const cfg = stageConfig(stage);
  return !!cfg && cfg.subStatuses.includes(subStatus);
}

function defaultSubStatus(stage) {
  const cfg = stageConfig(stage);
  return cfg ? cfg.subStatuses[0] : '';
}

// "<stage> - <sub>", collapsing to "<stage>" when the sub just repeats it.
function statusLabel(stage, subStatus) {
  if (!stage) return '';
  if (!subStatus || subStatus === stage) return stage;
  return `${stage} - ${subStatus}`;
}

// An old stage name (possibly with its old sub-status) -> today's
// { stage, subStatus }. Returns null if `raw` isn't a recognised old stage.
function resolveLegacyStage(rawStage, rawSub) {
  const hit = LEGACY_STAGE_MAP[rawStage];
  if (!hit) return null;
  const subStatus = (hit.subMap && hit.subMap[rawSub]) || hit.subStatus;
  return { stage: hit.stage, subStatus };
}

// Any stored status string ("Won", "New Lead", "Sales Meeting - Meeting
// Scheduled") → its (current) stage name. Kept name-compatible with earlier
// callers (dashboard / report controllers).
function stageForStatus(status) {
  if (!status) return 'New Lead';
  if (STAGE_NAMES.includes(status)) return status;
  if (LEGACY_STATUS_MAP[status]) return LEGACY_STATUS_MAP[status].stage;
  const sep = status.indexOf(' - ');
  if (sep !== -1) {
    const prefix = status.slice(0, sep);
    if (STAGE_NAMES.includes(prefix)) return prefix;
    const legacyHit = resolveLegacyStage(prefix, status.slice(sep + 3));
    if (legacyHit) return legacyHit.stage;
  }
  if (LEGACY_STAGE_MAP[status]) return LEGACY_STAGE_MAP[status].stage;
  // Bare sub-status?
  const owner = LEAD_STAGES.find((s) => s.subStatuses.includes(status));
  return owner ? owner.stage : 'New Lead';
}

// Resolve whatever a caller supplied (any of stage / subStatus / legacy
// `status`, including a pre-2026-10 stage name) into a consistent
// { stage, subStatus, status } triple.
function resolveStageSub({ stage, subStatus, status } = {}) {
  let s = stage;
  let sub = subStatus;

  if (s && !isValidStage(s)) {
    // A pre-2026-10 stage name stored directly on the document.
    const legacyHit = resolveLegacyStage(s, sub);
    if (legacyHit) {
      s = legacyHit.stage;
      sub = legacyHit.subStatus;
    }
  }

  if (!s && status) {
    if (LEGACY_STATUS_MAP[status]) {
      ({ stage: s, subStatus: sub } = LEGACY_STATUS_MAP[status]);
    } else {
      s = stageForStatus(status);
      const sep = status.indexOf(' - ');
      if (sep !== -1) sub = status.slice(sep + 3);
      else if (ALL_SUB_STATUSES.includes(status)) sub = status;
    }
  }

  if (!isValidStage(s)) s = 'New Lead';
  if (!isValidSubStatus(s, sub)) sub = defaultSubStatus(s);

  return { stage: s, subStatus: sub, status: statusLabel(s, sub) };
}

// Import helper — best-effort map a spreadsheet's free-text stage / status
// column onto the new structure.
function normalizeImported(rawStage, rawSub) {
  const raw = String(rawStage || '').trim();
  if (!raw && !rawSub) return resolveStageSub({ stage: 'New Lead' });

  // exact stage
  const stageHit = STAGE_NAMES.find((s) => s.toLowerCase() === raw.toLowerCase());
  if (stageHit) return resolveStageSub({ stage: stageHit, subStatus: rawSub });

  // legacy stage name (pre-2026-10)
  if (LEGACY_STAGE_MAP[raw]) return resolveStageSub({ stage: raw, subStatus: rawSub });

  // legacy flat value
  if (LEGACY_STATUS_MAP[raw]) return resolveStageSub({ status: raw });

  // "Stage - Sub"
  if (raw.includes(' - ')) return resolveStageSub({ status: raw });

  // bare sub-status
  const subOwner = LEAD_STAGES.find((s) =>
    s.subStatuses.some((x) => x.toLowerCase() === raw.toLowerCase())
  );
  if (subOwner) {
    const sub = subOwner.subStatuses.find((x) => x.toLowerCase() === raw.toLowerCase());
    return resolveStageSub({ stage: subOwner.stage, subStatus: sub });
  }

  return resolveStageSub({ stage: 'New Lead' });
}

// Quick-filter keys used by the Lead list + dashboard shortcuts.
const QUICK_FILTERS = [
  { key: 'all', label: 'All Leads' },
  { key: 'new', label: 'New Leads', stage: 'New Lead' },
  { key: 'fresh', label: 'Fresh Leads', stage: 'Fresh Leads' },
  { key: 'connected', label: 'Connected Leads', stage: 'Connected Leads' },
  { key: 'interested', label: 'Interested Leads', stage: 'Interested Leads' },
  { key: 'future', label: 'Future Prospect', stage: 'Future Prospect' },
  { key: 'callback-today', label: 'Call Back Today', special: 'callbackToday' },
  { key: 'callback-overdue', label: 'Overdue Call Back', special: 'callbackOverdue' },
  { key: 'demo-booking', label: 'Demo Booking', stage: 'Demo Booking' },
  { key: 'prospects', label: 'Prospects', stage: 'Prospects' },
  { key: 'enrolled', label: 'Enrolled', stage: 'Enrolled' },
  { key: 'not-interested', label: 'Not Interested', stage: 'Not Interested Leads' },
  { key: 'invalid', label: 'Invalid', stage: 'Invalid Leads' },
];

module.exports = {
  LEAD_STAGES,
  LEGACY_STAGE_MAP,
  LEGACY_STATUS_MAP,
  STAGE_NAMES,
  SUB_STATUSES_BY_STAGE,
  ALL_SUB_STATUSES,
  QUICK_FILTERS,
  stageConfig,
  isValidStage,
  isValidSubStatus,
  defaultSubStatus,
  statusLabel,
  stageForStatus,
  resolveLegacyStage,
  resolveStageSub,
  normalizeImported,
};
