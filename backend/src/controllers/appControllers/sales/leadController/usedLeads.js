const mongoose = require('mongoose');
const { last10, callReachedCustomer } = require('../../../../services/calling/callingShared');
const { BY_CODE } = require('../../../../services/calling/dispositions');

// Used leads: every number that's genuinely been DIALLED through this CRM's own calling
// system — auto-dialer pool, Dialer screen, Leads page, Callbacks — one row
// per number, showing its most recent call (by `caller`, when one is
// picked). Built from CallRecord, the one place every placed call is logged;
// Lead.callHistory misses calls (a cloud Dialer call never wrote to it, nor
// did a re-dial of a lead already past the auto-dialer's stages), which is
// why a sales user's connected calls used to go missing from this list.
// Lead details (name, assignee, team) are joined by phone number.
const IN_PROGRESS = ['queued', 'dialing', 'ringing'];
const SCAN_LIMIT = 3000;

// connected → the customer answered; notpicked → they never did
// (callingShared.callReachedCustomer — the same rule as My Calls).
const outcomeOf = (r) => (callReachedCustomer(r) ? 'connected' : 'notpicked');

// One row per dialled number (see the header). Shared by the endpoint and
// parkedPhones() below.
async function buildUsedRows({ caller = '', outcome = '' } = {}) {
  const CallRecord = mongoose.model('CallRecord');
  const Lead = mongoose.model('Lead');

  // caller=none → numbers no sales user ever called (only the auto-dialer
  // pool touched them) — filtered after grouping, since that's a per-number
  // property, not a per-call one.
  const noUser = caller === 'none';
  const filter = { removed: false, status: { $nin: IN_PROGRESS } };
  if (!noUser && caller && mongoose.isValidObjectId(caller)) filter.agent = caller;

  const calls = await CallRecord.find(filter)
    .sort({ created: -1 })
    .limit(SCAN_LIMIT)
    .select('contactName phone status disposition answeredAt duration agentName created endedAt')
    .lean();

  // Most recent call per number (calls are newest-first), and the most
  // recent rep who actually spoke to that number — shown under "Assigned"
  // when the lead has no owner (Instant Lead Pool calls don't assign one).
  const latest = new Map();
  const talkedBy = new Map();
  const userCalled = new Set(); // numbers at least one sales user dialled
  for (const c of calls) {
    const key = last10(c.phone);
    if (!key) continue;
    if (!latest.has(key)) latest.set(key, c);
    if (c.agentName) userCalled.add(key);
    if (!talkedBy.has(key) && c.agentName && callReachedCustomer(c)) talkedBy.set(key, c.agentName);
  }

  const leads = latest.size
    ? await Lead.find({ removed: false, phoneNormalized: { $in: [...latest.keys()] } })
        .select('name phone phoneNormalized stage subStatus assignedUserName team usedReleasedAt')
        .lean()
    : [];
  const leadByPhone = new Map(leads.map((l) => [l.phoneNormalized, l]));

  const rows = [];
  for (const [key, c] of latest) {
    const callOutcome = outcomeOf(c);
    if (outcome && callOutcome !== outcome) continue;
    const lead = leadByPhone.get(key);
    if (noUser && (userCalled.has(key) || (lead && lead.assignedUserName))) continue;
    const d = c.disposition && BY_CODE[c.disposition];
    const lastContactAt = c.endedAt || c.created;
    rows.push({
      _id: lead ? lead._id : c._id,
      key,
      isLead: !!lead, // false = a number not in the CRM (can't be moved to a stage)
      name: (lead && lead.name) || c.contactName || 'Unknown Number',
      phone: (lead && lead.phone) || c.phone,
      stage: lead ? lead.stage : null,
      subStatus: lead ? lead.subStatus : null,
      response: d ? d.label : callOutcome === 'connected' ? 'Connected' : 'Not picked up',
      outcome: callOutcome,
      calledBy: c.agentName || null,
      assignedUserName: (lead && lead.assignedUserName) || talkedBy.get(key) || null,
      // true = no owner on the lead; the name is the rep who spoke to them.
      assignedFromCall: !(lead && lead.assignedUserName) && talkedBy.has(key),
      // Counts as assigned when it has a Lead Owner OR a sales user's call
      // connected with them (that rep has it). false = no user has it yet.
      owned: !!(lead && lead.assignedUserName) || talkedBy.has(key),
      // No sales user has ever dialled this number — only the auto-dialer pool.
      noUser: !userCalled.has(key) && !(lead && lead.assignedUserName),
      // Sent back to a pipeline stage from Used Leads after its last call
      // (moveToStage) — it's back in Lead Stages, not parked here.
      released: !!(lead && lead.usedReleasedAt && new Date(lead.usedReleasedAt) >= new Date(lastContactAt)),
      team: (lead && lead.team) || null,
      lastContactAt,
    });
  }
  return rows;
}

// Phones (last10) of used leads no user has — dialled, but no Lead Owner,
// no sales user connected, and not sent back to a stage since. Lead Stages
// leaves these out (they live in Used Leads → "Not with any user") so the
// same lead isn't counted in both. Cached briefly: the board, the list and
// bulk assign all ask within one page load.
let _parked = { at: 0, set: null, used: null };
async function loadPhoneSets() {
  if (_parked.set && Date.now() - _parked.at < 60 * 1000) return _parked;
  const rows = await buildUsedRows();
  _parked = {
    at: Date.now(),
    set: rows.filter((r) => r.isLead && !r.owned && !r.released).map((r) => r.key),
    // every used lead that is in the CRM — the Lead Stages "Used Leads" tab (same rows as the Used Leads page)
    used: rows.filter((r) => r.isLead).map((r) => r.key),
  };
  return _parked;
}
async function parkedPhones() {
  return (await loadPhoneSets()).set;
}
async function usedLeadPhones() {
  return (await loadPhoneSets()).used;
}
module.exports = { buildUsedRows, parkedPhones, usedLeadPhones };
