// ─────────────────────────────────────────────────────────────────────────
// Lead pipeline: 13 stages, each with its own dependent sub-status list.
// This file is the single source of truth for both backend and frontend
// (frontend/src/config/leadStages.js is a generated-by-hand ESM mirror —
// keep the two in sync).
//
// A lead carries BOTH `stage` and `subStatus`. `status` is a denormalised
// convenience mirror ("<stage> - <subStatus>", or just "<stage>" when the
// sub-status repeats the stage name) kept in sync by a Lead pre-save /
// pre-findOneAndUpdate hook, so every place in the app that still reads
// `lead.status` keeps working unchanged.
// ─────────────────────────────────────────────────────────────────────────

const LEAD_STAGES = [
  {
    stage: 'New Lead',
    color: '#2563EB',
    badgeClass: 'hub-badge-blue',
    description: 'Newly and freshly generated leads.',
    subStatuses: ['Newly Generated', 'Freshly Generated'],
  },
  {
    stage: 'Contacted',
    color: '#06B6D4',
    badgeClass: 'hub-badge-blue',
    description: 'First contact with the lead has been done.',
    subStatuses: ['First Contact Done'],
  },
  {
    stage: 'SUP Call',
    color: '#8B5CF6',
    badgeClass: 'hub-badge-purple',
    description: 'Supervisor intervention / call required, or supervisor call completed.',
    subStatuses: ['Need Supervisor Call', 'Supervisor Call Done'],
  },
  {
    stage: 'Fresh Lead',
    color: '#22C55E',
    badgeClass: 'hub-badge-green',
    description: 'Fresh lead which is still being evaluated.',
    subStatuses: ['Fresh Lead'],
  },
  {
    stage: 'Future Prospects',
    color: '#14B8A6',
    badgeClass: 'hub-badge-blue',
    description: 'Prospect is interested but planning to join within a future period.',
    subStatuses: ['Within 1 Month', 'Within 2 Months', 'Within 3 Months'],
    // Any sub-status here asks for an expected follow-up date.
    capture: 'futureFollowUp',
  },
  {
    stage: 'Invalid',
    color: '#94A3B8',
    badgeClass: 'hub-badge-gray',
    description: 'Lead is invalid or cannot be contacted / was not a genuine enquiry.',
    subStatuses: ['Wrong Number', 'Not in Service', 'Incoming Not Available', 'Did Not Enquire'],
  },
  {
    stage: 'Interested',
    color: '#F97316',
    badgeClass: 'hub-badge-yellow',
    description: 'Lead has shown interest in the workshop / program.',
    subStatuses: ['Workshop Prospect', 'Workshop Attended', 'Post Workshop No Response'],
  },
  {
    stage: 'Sales Meeting',
    color: '#6366F1',
    badgeClass: 'hub-badge-purple',
    description: 'Sales meeting lifecycle.',
    subStatuses: [
      'Meeting Scheduled',
      'Sales Meeting Done',
      'Sales Meeting Pending',
      'Sales Meeting Rescheduled',
    ],
    // These sub-statuses require a meeting date/time.
    meetingSubStatuses: ['Meeting Scheduled', 'Sales Meeting Rescheduled'],
  },
  {
    stage: 'Enrolled',
    color: '#16A34A',
    badgeClass: 'hub-badge-green',
    description: 'Registration has been completed.',
    subStatuses: ['Registration Done'],
    capture: 'enrolledAt',
  },
  {
    stage: 'No Response',
    color: '#FB923C',
    badgeClass: 'hub-badge-yellow',
    description: 'Lead could not be reached.',
    subStatuses: ['Ringing', 'No Response'],
  },
  {
    stage: 'Not Interested',
    color: '#EF4444',
    badgeClass: 'hub-badge-red',
    description: 'Lead is not interested due to a specific reason.',
    subStatuses: ['Price Too High', 'Joined Somewhere Else', 'No Money'],
  },
  {
    stage: 'Call Back',
    color: '#EC4899',
    badgeClass: 'hub-badge-purple',
    description: 'Lead requested a callback. Callback date & time are mandatory.',
    subStatuses: ['Call Back Requested'],
    requiresCallBack: true,
  },
  {
    stage: 'Opportunity',
    color: '#10B981',
    badgeClass: 'hub-badge-green',
    description: 'High-potential lead where the sales process has progressed.',
    subStatuses: ['Meeting Done', 'Registration Link Shared'],
    linkSubStatuses: ['Registration Link Shared'],
  },
];

// Legacy 5-value status → { stage, subStatus } in the new model. Used by
// the migration script and as a read-time fallback so an un-migrated lead
// still resolves sensibly.
const LEGACY_STATUS_MAP = {
  New: { stage: 'New Lead', subStatus: 'Newly Generated' },
  Contacted: { stage: 'Contacted', subStatus: 'First Contact Done' },
  Qualified: { stage: 'Interested', subStatus: 'Workshop Prospect' },
  Won: { stage: 'Enrolled', subStatus: 'Registration Done' },
  Lost: { stage: 'Not Interested', subStatus: 'Price Too High' },
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

// Any stored status string ("Won", "New Lead", "Sales Meeting - Meeting
// Scheduled") → its stage name. Kept name-compatible with earlier callers
// (dashboard / report controllers).
function stageForStatus(status) {
  if (!status) return 'New Lead';
  if (STAGE_NAMES.includes(status)) return status;
  if (LEGACY_STATUS_MAP[status]) return LEGACY_STATUS_MAP[status].stage;
  const sep = status.indexOf(' - ');
  if (sep !== -1) {
    const prefix = status.slice(0, sep);
    if (STAGE_NAMES.includes(prefix)) return prefix;
  }
  // Bare sub-status?
  const owner = LEAD_STAGES.find((s) => s.subStatuses.includes(status));
  return owner ? owner.stage : 'New Lead';
}

// Resolve whatever a caller supplied (any of stage / subStatus / legacy
// `status`) into a consistent { stage, subStatus, status } triple.
function resolveStageSub({ stage, subStatus, status } = {}) {
  let s = stage;
  let sub = subStatus;

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

  // legacy value
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
  { key: 'contacted', label: 'Contacted', stage: 'Contacted' },
  { key: 'interested', label: 'Interested', stage: 'Interested' },
  { key: 'future', label: 'Future Prospects', stage: 'Future Prospects' },
  { key: 'callback-today', label: 'Call Back Today', special: 'callbackToday' },
  { key: 'callback-overdue', label: 'Overdue Call Back', special: 'callbackOverdue' },
  { key: 'sales-meeting', label: 'Sales Meeting', stage: 'Sales Meeting' },
  { key: 'opportunity', label: 'Opportunity', stage: 'Opportunity' },
  { key: 'enrolled', label: 'Enrolled', stage: 'Enrolled' },
  { key: 'not-interested', label: 'Not Interested', stage: 'Not Interested' },
  { key: 'invalid', label: 'Invalid', stage: 'Invalid' },
];

module.exports = {
  LEAD_STAGES,
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
  resolveStageSub,
  normalizeImported,
};
