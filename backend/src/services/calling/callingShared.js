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
  const Team = mongoose.model('Team');

  const phoneNormalized = last10(callLead.phone);
  let lead = phoneNormalized
    ? await Lead.findOne({ removed: false, phoneNormalized }).select('_id')
    : null;

  if (!lead) {
    const d = dispositionCode && BY_CODE[dispositionCode];
    const team = callRecord.agentName
      ? await Team.findOne({ removed: false, members: callRecord.agentName }).select('name').lean()
      : null;
    const outcomeLabel = d ? d.label : dispositionCode || 'Call outcome';

    lead = await new Lead({
      name: callLead.name,
      phone: callLead.phone,
      email: callLead.email || undefined,
      source: 'Auto-Dialer',
      stage: 'Interested',
      subStatus: 'Workshop Prospect',
      assignedUser: callRecord.agent || undefined,
      assignedUserName: callRecord.agentName || undefined,
      team: team ? team.name : undefined,
      stageHistory: [
        {
          toStage: 'Interested',
          toSubStatus: 'Workshop Prospect',
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

// Roll the linked CallLead forward from a disposition code or a raw outcome,
// bridging it into the Sales pipeline when the outcome shows real interest.
async function resolveLead(callRecord, dispositionCode, rawOutcome) {
  if (!callRecord || !callRecord.callLead) return;
  const CallLead = mongoose.model('CallLead');
  const callLead = await CallLead.findById(callRecord.callLead);
  if (!callLead) return;

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

module.exports = {
  digitsOnly,
  last10,
  secs,
  setAgent,
  wrapupAgent,
  resolveLead,
  recountCampaign,
  withinCallingHours,
};
