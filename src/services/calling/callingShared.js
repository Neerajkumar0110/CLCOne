const mongoose = require('mongoose');
const { BY_CODE } = require('./dispositions');

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

// Roll the linked CallLead forward from a disposition code or a raw outcome.
async function resolveLead(callRecord, dispositionCode, rawOutcome) {
  if (!callRecord || !callRecord.callLead) return;
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
  const set = { status, lastDisposition: dispositionCode || undefined };
  if (status === 'DNC') set.dncAt = new Date();
  await mongoose.model('CallLead').updateOne({ _id: callRecord.callLead }, { $set: set });
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
