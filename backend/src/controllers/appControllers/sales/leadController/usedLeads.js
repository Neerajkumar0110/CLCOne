const mongoose = require('mongoose');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');
const { last10, callReachedCustomer } = require('../../../../services/calling/callingShared');
const { BY_CODE } = require('../../../../services/calling/dispositions');

// GET /api/lead/used?caller=<adminId>&outcome=connected|notpicked
// Every number that's genuinely been DIALLED through this CRM's own calling
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

const usedLeads = async (req, res) => {
  // Management-only (the Leads page hides the tab for everyone else).
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: [], message: 'Used Leads is available to management only.' });
  }
  const CallRecord = mongoose.model('CallRecord');
  const Lead = mongoose.model('Lead');

  const caller = String(req.query.caller || '').trim();
  const outcome = ['connected', 'notpicked'].includes(req.query.outcome) ? req.query.outcome : '';

  const filter = { removed: false, status: { $nin: IN_PROGRESS } };
  if (caller && mongoose.isValidObjectId(caller)) filter.agent = caller;

  const calls = await CallRecord.find(filter)
    .sort({ created: -1 })
    .limit(SCAN_LIMIT)
    .select('contactName phone status disposition answeredAt duration agentName created endedAt')
    .lean();

  // Most recent call per number (calls are newest-first).
  const latest = new Map();
  for (const c of calls) {
    const key = last10(c.phone);
    if (key && !latest.has(key)) latest.set(key, c);
  }

  const leads = latest.size
    ? await Lead.find({ removed: false, phoneNormalized: { $in: [...latest.keys()] } })
        .select('name phone phoneNormalized stage subStatus assignedUserName team')
        .lean()
    : [];
  const leadByPhone = new Map(leads.map((l) => [l.phoneNormalized, l]));

  const rows = [];
  for (const [key, c] of latest) {
    const callOutcome = outcomeOf(c);
    if (outcome && callOutcome !== outcome) continue;
    const lead = leadByPhone.get(key);
    const d = c.disposition && BY_CODE[c.disposition];
    rows.push({
      _id: lead ? lead._id : c._id,
      name: (lead && lead.name) || c.contactName || 'Unknown Number',
      phone: (lead && lead.phone) || c.phone,
      stage: lead ? lead.stage : null,
      subStatus: lead ? lead.subStatus : null,
      response: d ? d.label : callOutcome === 'connected' ? 'Connected' : 'Not picked up',
      outcome: callOutcome,
      calledBy: c.agentName || null,
      assignedUserName: (lead && lead.assignedUserName) || null,
      team: (lead && lead.team) || null,
      lastContactAt: c.endedAt || c.created,
    });
  }

  return res.status(200).json({ success: true, result: rows, message: 'ok' });
};

module.exports = usedLeads;
