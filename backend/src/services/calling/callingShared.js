const mongoose = require('mongoose');
const { BY_CODE } = require('./dispositions');
const { notify } = require('../../notify');

// Lifecycle helpers shared by CloudCallProvider (outbound auto-dialer) and
// cloudWebhook.js (inbound IVR + provider call-status callbacks). Kept
// provider-agnostic: they only touch CallRecord / CallLead / CallCampaign /
// AgentCallState, never a telephony API.

const digitsOnly = (s) => String(s || '').replace(/[^\d]/g, '');
const last10 = (s) => {
  const d = digitsOnly(s);
  return d.length > 10 ? d.slice(-10) : d;
};
const secs = (from, to) => Math.max(0, Math.round((new Date(to) - new Date(from)) / 1000));

// ── agent capacity / dial pacing ────────────────────────────────────────
//
// A CallRecord in any of these states is occupying its agent's one and only
// line: the customer is being dialled, is ringing, is talking, or is on
// hold. Anything else (completed / failed / no-answer / …) is over and
// frees the agent. Every capacity decision in the dialer is phrased in
// terms of this list, so "busy" can never drift between call-sites.
const LIVE_CALL_STATUSES = ['dialing', 'ringing', 'connected', 'onhold'];

// An agent's presence row is "occupied" in these states — Ringing covers
// both a real ringing customer leg and a dial we have reserved them for
// but not placed yet (see reserveAgent).
const BUSY_AGENT_STATUSES = ['Ringing', 'OnCall'];

// How long an agent may sit in a reserved/busy presence state with no live
// call behind it before the reaper frees them. Must stay above the longest
// plausible customer ring (the stuck-dial sweep uses the same 120s) so a
// genuinely ringing customer is never cut short.
const RESERVATION_TTL_MS = 120 * 1000;

// Atomically reserve ONE agent for a dial — the core of the pacing
// algorithm, and the reason an agent can no longer be handed two calls.
//
// The old engine read the list of Available agents and then dialled them in
// a loop. That is a read-then-write race: tick() runs from the 8s cron job
// AND on demand from every polled read endpoint, so two ticks would both
// see "agent X is Available", both pick a (different) lead, and both place
// a call to the same agent. findOneAndUpdate is atomic per document, so the
// loser of that race now gets null and dials nothing.
//
// `sort: { since: 1 }` hands the call to whoever has been idle longest —
// the same longest-waiting-agent routing a real ACD uses, and what
// claimLeadPoolAgent already does on the answer side. Returns the claimed
// presence row, or null when nobody is free (→ no call goes out at all).
async function reserveAgent({ agentIds, campaignId }) {
  if (!agentIds || !agentIds.length) return null;
  return mongoose.model('AgentCallState').findOneAndUpdate(
    { agent: { $in: agentIds }, status: 'Available' },
    {
      $set: {
        status: 'Ringing',
        campaign: campaignId || null,
        currentCall: null,
        since: new Date(),
        lastSeenAt: new Date(),
      },
    },
    { sort: { since: 1 }, new: true }
  );
}

// Hand a reserved agent back when the dial never happened (no leads left,
// provider rejected the call). Guarded on `status: 'Ringing'` so it can
// never clobber a genuine call that landed in between.
async function releaseAgent(agentId) {
  if (!agentId) return;
  await mongoose.model('AgentCallState').updateOne(
    { agent: agentId, status: 'Ringing' },
    { $set: { status: 'Available', currentCall: null, since: new Date(), lastSeenAt: new Date() } }
  );
}

// Agents out of these who are already on a live call, by id string.
//
// AgentCallState is meant to answer this on its own, but it is written by
// provider webhooks that can be lost or delayed, and it is per-agent rather
// than per-call. CallRecord is the ground truth, and it covers calls this
// campaign cannot see at all — a manual click-to-call, an inbound IVR
// transfer, another campaign's auto-dial. Checking it keeps the dialer from
// calling an agent who is demonstrably mid-conversation.
async function agentsOnLiveCalls(agentIds) {
  if (!agentIds || !agentIds.length) return new Set();
  const rows = await mongoose
    .model('CallRecord')
    .find({ agent: { $in: agentIds }, removed: false, status: { $in: LIVE_CALL_STATUSES } })
    .select('agent')
    .lean();
  return new Set(rows.map((r) => String(r.agent)));
}

// Free agents pinned "busy" by a presence row whose call is already over —
// a reservation whose dial threw before placeCall, or a call whose hangup
// webhook never arrived. Without this an agent can be parked out of the
// rotation for the rest of the shift and the dialer will simply never call
// them again.
//
// The test is "does this agent have ANY live call", NOT "does their
// currentCall point at one". Those are not the same thing and the
// difference is a live-call-dropping bug: plivoAnswer's claimLeadPoolAgent
// flips a pool agent to Ringing WITHOUT setting currentCall (it claims them
// the instant a customer answers, before the bridge exists), so keying off
// currentCall alone would free an agent whose phone is ringing right now
// and let the dialer hand them a second customer — exactly the fault this
// pacing work exists to remove.
async function reapStaleAgentReservations() {
  const AgentCallState = mongoose.model('AgentCallState');
  const stale = await AgentCallState.find({
    status: { $in: BUSY_AGENT_STATUSES },
    since: { $lte: new Date(Date.now() - RESERVATION_TTL_MS) },
  })
    .select('agent currentCall')
    .limit(200)
    .lean();
  if (!stale.length) return 0;

  const busy = await agentsOnLiveCalls(stale.map((s) => s.agent));
  const orphaned = stale.filter((s) => !busy.has(String(s.agent))).map((s) => s.agent);
  if (!orphaned.length) return 0;

  const r = await AgentCallState.updateMany(
    { agent: { $in: orphaned }, status: { $in: BUSY_AGENT_STATUSES } },
    { $set: { status: 'Available', currentCall: null, since: new Date(), lastSeenAt: new Date() } }
  );
  return r.modifiedCount || 0;
}

// Push a patch onto an agent's live presence row (upsert).
async function setAgent(agentId, patch) {
  if (!agentId) return;
  await mongoose.model('AgentCallState').updateOne(
    { agent: agentId },
    { $set: { ...patch, lastSeenAt: new Date() } },
    { upsert: true }
  );
}

// Move an agent into Wrapup after a call ends, bumping their day counters.
async function wrapupAgent(callRecord, actorName) {
  if (!callRecord || !callRecord.agent) return;
  await mongoose.model('AgentCallState').updateOne(
    { agent: callRecord.agent },
    {
      $set: {
        status: 'Wrapup',
        currentCall: null,
        since: new Date(),
        lastSeenAt: new Date(),
        ...(actorName ? { agentName: actorName } : {}),
      },
      $inc: { callsToday: 1, talkSecondsToday: callRecord.duration || 0 },
    },
    { upsert: true }
  );
}

// Dispositions that mean the contact showed real interest — these are the
// ones worth surfacing in the actual Sales pipeline, not just left sitting
// in the calling module's own CallLead list where a sales rep never sees
// them. ('sale' = SALE, 'callback' = INTERESTED/CALLBACK — see dispositions.js)
const CRM_BRIDGE_CATEGORIES = ['sale', 'callback'];

// Link (or create) the CRM `Lead` a genuinely-interested CallLead deserves.
// CallLead.crmLead is a one-way, set-once link — once a contact has a real
// Lead, later calls in the same or another campaign just keep dispositioning
// the same Lead's history rather than spawning duplicates.
async function bridgeToCrmLead(callLead, callRecord, dispositionCode) {
  if (!callLead || callLead.crmLead) return;
  const Lead = mongoose.model('Lead');

  const phoneNormalized = last10(callLead.phone);
  let lead = phoneNormalized
    ? await Lead.findOne({ removed: false, phoneNormalized }).select('_id')
    : null;

  if (!lead) {
    const d = dispositionCode && BY_CODE[dispositionCode];
    const outcomeLabel = d ? d.label : dispositionCode || 'Call outcome';

    // A campaign belongs to exactly one department (CallCampaign.team is
    // set once, at campaign creation — the auto-dialer only ever works a
    // single department's leads through a given campaign). That's the
    // authoritative source for which team this lead belongs to; the
    // calling agent's own Team membership is only a fallback for the rare
    // campaign that was never tagged with one.
    let teamName;
    if (callRecord.campaign) {
      const CallCampaign = mongoose.model('CallCampaign');
      const camp = await CallCampaign.findById(callRecord.campaign).select('team').lean();
      teamName = camp && camp.team;
    }
    if (!teamName && callRecord.agentName) {
      const Team = mongoose.model('Team');
      const t = await Team.findOne({ removed: false, members: callRecord.agentName }).select('name').lean();
      teamName = t && t.name;
    }

    lead = await new Lead({
      name: callLead.name,
      phone: callLead.phone,
      email: callLead.email || undefined,
      source: 'Auto-Dialer',
      stage: 'Demo Booking',
      subStatus: 'Demo Booked',
      assignedUser: callRecord.agent || undefined,
      assignedUserName: callRecord.agentName || undefined,
      team: teamName || undefined,
      stageHistory: [
        {
          toStage: 'Demo Booking',
          toSubStatus: 'Demo Booked',
          changedByName: callRecord.agentName || undefined,
          remarks: `Auto-created from a calling-campaign call (${outcomeLabel})`,
          at: new Date(),
        },
      ],
      callHistory: [
        {
          outcome: outcomeLabel,
          notes: callRecord.notes || undefined,
          byName: callRecord.agentName || undefined,
          at: new Date(),
        },
      ],
    }).save();

    notify({
      audience: 'team',
      teamName: lead.team,
      module: 'Leads',
      type: 'lead.created',
      title: `New lead: ${lead.name}`,
      body: `via Auto-Dialer (${outcomeLabel})`,
      link: '/leads',
    }).catch(() => {});
  }

  callLead.crmLead = lead._id;
}

// A lead the Instant Lead Pool queued (see leadPoolSyncTick.js) already
// points `crmLead` at the real Lead it came FROM — bridgeToCrmLead's own
// job is done before it's even called (it no-ops on an already-linked
// callLead). What's still missing for that case is rolling the outcome
// back onto the ORIGINAL Lead's own stage, exactly the way a manually
// dialled Lead advances from the Dialer screen — otherwise it would just
// sit at "New Lead" forever and get re-queued next sync.
async function advanceCrmLead(leadId, dispositionCode, rawOutcome, callRecord) {
  const Lead = mongoose.model('Lead');
  const lead = await Lead.findOne({ _id: leadId, removed: false });
  // Only ever move it forward from wherever the auto-dialer itself left it
  // last time — never overwrite progress a human has since made (e.g. it's
  // already in Demo Booking because someone worked it by hand).
  if (!lead || !['New Lead', 'Connected Leads', 'No Response'].includes(lead.stage)) return;

  const d = dispositionCode && BY_CODE[dispositionCode];
  let stage, subStatus;
  if (d) {
    // dispositions.js owns the outcome → (stage, subStatus) mapping so the
    // auto-dialer here and the agent's in-call modal can never drift apart.
    ({ stage, subStatus } = d.crmStage);
  } else if (rawOutcome === 'connected') {
    stage = 'Connected Leads';
    subStatus = '1st Discussion Done - Qualified';
  } else {
    stage = 'No Response';
    subStatus = 'Not Reachable';
  }

  const outcomeLabel = d ? d.label : rawOutcome || 'No Answer';
  const fromStage = lead.stage;
  lead.stage = stage;
  lead.subStatus = subStatus;
  lead.callHistory.push({ outcome: outcomeLabel, byName: callRecord.agentName || undefined, at: new Date() });
  lead.stageHistory.push({
    fromStage,
    toStage: stage,
    toSubStatus: subStatus,
    changedByName: callRecord.agentName || undefined,
    remarks: `Instant Lead Pool call outcome: ${outcomeLabel}`,
    at: new Date(),
  });
  await lead.save();
}

// Roll the linked CallLead forward from a disposition code or a raw outcome,
// bridging it into the Sales pipeline when the outcome shows real interest.
async function resolveLead(callRecord, dispositionCode, rawOutcome) {
  if (!callRecord || !callRecord.callLead) return;
  const CallLead = mongoose.model('CallLead');
  const callLead = await CallLead.findById(callRecord.callLead);
  if (!callLead) return;
  const preLinkedLeadId = callLead.crmLead || null;

  let status = 'Completed';
  const d = dispositionCode && BY_CODE[dispositionCode];
  if (d) {
    if (d.category === 'callback') status = 'Callback';
    else if (d.category === 'dnc') status = 'DNC';
    else status = 'Completed';
  } else if (rawOutcome) {
    status =
      { 'no-answer': 'No Answer', busy: 'Busy', failed: 'Failed', voicemail: 'Voicemail', connected: 'Connected' }[
        rawOutcome
      ] || 'Completed';
  }
  callLead.status = status;
  callLead.lastDisposition = dispositionCode || callLead.lastDisposition;
  if (status === 'DNC') callLead.dncAt = new Date();

  if (d && CRM_BRIDGE_CATEGORIES.includes(d.category)) {
    await bridgeToCrmLead(callLead, callRecord, dispositionCode);
  }
  await callLead.save();

  if (preLinkedLeadId) {
    await advanceCrmLead(preLinkedLeadId, dispositionCode, rawOutcome, callRecord);
  }
}

// Lazily finds (or creates, once) the single system campaign behind the
// per-agent "Instant Lead Pool" toggle — see leadPool.js (toggle/status
// endpoints) and leadPoolSyncTick.js (feeds it from Lead, notifies on
// exhaustion). Always Active: participation is controlled per-agent via
// AgentCallState, exactly like joining/leaving any other campaign, not by
// pausing the campaign itself.
async function getOrCreateLeadPoolCampaign() {
  const CallCampaign = mongoose.model('CallCampaign');
  let camp = await CallCampaign.findOne({ isLeadPool: true, removed: false });
  if (!camp) {
    camp = await new CallCampaign({
      name: 'Instant Lead Pool',
      description: 'System-managed — fed automatically from New Lead stage Sales leads. Join/leave from the Calls page toggle.',
      campaignType: 'Outbound',
      isLeadPool: true,
      autoDial: true,
      dialRatio: 2,
      status: 'Active',
      agents: [],
    }).save();
  }
  return camp;
}

// Recompute a campaign's denormalised counters from its leads + call records.
async function recountCampaign(campaignId) {
  if (!campaignId) return;
  const CallLead = mongoose.model('CallLead');
  const CallRecord = mongoose.model('CallRecord');
  const oid = new mongoose.Types.ObjectId(String(campaignId));
  const [byStatus, connected, failed] = await Promise.all([
    CallLead.aggregate([
      { $match: { campaign: oid, removed: false } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    CallRecord.countDocuments({
      campaign: campaignId,
      removed: false,
      status: { $in: ['connected', 'onhold', 'completed', 'transferred'] },
      answeredAt: { $ne: null },
    }),
    CallRecord.countDocuments({
      campaign: campaignId,
      removed: false,
      status: { $in: ['failed', 'busy', 'no-answer', 'voicemail'] },
    }),
  ]);
  const map = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
  const total = byStatus.reduce((s, r) => s + r.n, 0);
  const pending = (map['New'] || 0) + (map['Queued'] || 0);
  await mongoose.model('CallCampaign').updateOne(
    { _id: campaignId },
    {
      $set: {
        'stats.totalLeads': total,
        'stats.pending': pending,
        'stats.dialed': total - pending,
        'stats.connected': connected,
        'stats.failed': failed,
        'stats.callbacks': map['Callback'] || 0,
      },
    }
  );
}

// "HH:mm" window check in server-local time. Empty start/end = always open.
function withinCallingHours(campaign, now = new Date()) {
  const s = campaign.callingHoursStart;
  const e = campaign.callingHoursEnd;
  if (!s || !e) return true;
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + (sm || 0);
  const end = eh * 60 + (em || 0);
  return start <= end ? mins >= start && mins <= end : mins >= start || mins <= end;
}

// Dispatches real-time call event to the agent's screen via Socket.IO
async function notifyAgentCallEvent(agentId, event, callRecord) {
  if (!agentId || !callRecord) return;
  try {
    const { emitCallToAgent } = require('../../socket');
    const CallLead = mongoose.model('CallLead');
    const Lead = mongoose.model('Lead');

    const lead = callRecord.callLead
      ? await CallLead.findById(callRecord.callLead).lean()
      : null;

    let crmLead = null;
    if (lead && lead.crmLead) {
      crmLead = await Lead.findById(lead.crmLead).lean();
    } else if (callRecord.phone) {
      const norm = String(callRecord.phone).replace(/[^\d]/g, '').slice(-10);
      if (norm) {
        crmLead = await Lead.findOne({ phoneNormalized: norm, removed: false }).lean();
      }
    }

    emitCallToAgent(agentId, event, {
      call: callRecord.toObject ? callRecord.toObject() : callRecord,
      lead,
      crmLead,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[calling] notifyAgentCallEvent error:', err.message);
  }
}

module.exports = {
  digitsOnly,
  last10,
  secs,
  LIVE_CALL_STATUSES,
  BUSY_AGENT_STATUSES,
  RESERVATION_TTL_MS,
  reserveAgent,
  releaseAgent,
  agentsOnLiveCalls,
  reapStaleAgentReservations,
  setAgent,
  wrapupAgent,
  resolveLead,
  recountCampaign,
  withinCallingHours,
  getOrCreateLeadPoolCampaign,
  notifyAgentCallEvent,
};
