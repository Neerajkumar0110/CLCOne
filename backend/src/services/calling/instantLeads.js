const mongoose = require('mongoose');
const {
  getOrCreateLeadPoolCampaign,
  agentsOnLiveCalls,
  reserveAgent,
  releaseAgent,
  callReachedCustomer,
  last10,
} = require('./callingShared');

// Instant call for a fresh Facebook lead.
//
// The moment a new lead lands from a Facebook Lead Ad (facebookController/
// webhook.js processWebhookLog marks it instantDispatch.status='pending'),
// the next CloudCallProvider.tick() hands it to ONE active agent — someone
// in the Instant Lead Pool, Available and not on a call — and dials it right
// away (customer first, then that agent's phone, like every cloud call).
//
// Round-robin: the agent whose last instant lead was longest ago (or who
// never had one) goes first, so every active agent gets one before anyone
// gets a second (AgentCallState.lastInstantLeadAt).
//
// Ownership after the call (settleInstantLead, from resolveLead):
//   spoke to the customer → the lead stays with that agent;
//   anything else          → owner cleared, it stays in Lead Stages.
// The stage itself moves by the agent's response exactly like any other
// call (callingShared.advanceCrmLead via the linked CallLead).
//
// Nobody active → the lead simply waits; the first agent who turns the pool
// on gets it. After 24h with nobody it expires into the normal pipeline.
const EXPIRE_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

// Every Sales user + CRM admin sees "new lead → who got it" live.
async function broadcastAssignment(lead, agentName) {
  try {
    const { emitCallToAgent } = require('../../socket');
    const { SALES_ROLES, CRM_ADMIN_ROLES } = require('../../config/roles');
    const users = await mongoose
      .model('Admin')
      .find({ removed: false, enabled: true, role: { $in: [...new Set([...SALES_ROLES, ...CRM_ADMIN_ROLES])] } })
      .select('_id')
      .lean();
    const payload = {
      leadId: String(lead._id),
      name: lead.name,
      phone: lead.phone,
      source: lead.source || 'Facebook Ads',
      form: lead.metaFormName || null,
      agentName,
      at: new Date(),
    };
    for (const u of users) emitCallToAgent(u._id, 'lead:instant', payload);
  } catch (err) {
    console.error('[instantLeads] broadcast failed:', err.message);
  }
}

async function dispatchInstantLeads(provider) {
  const Lead = mongoose.model('Lead');
  const now = Date.now();

  // Too old to be "instant" any more — leave it to the normal pipeline.
  await Lead.updateMany(
    { 'instantDispatch.status': 'pending', 'instantDispatch.at': { $lt: new Date(now - EXPIRE_MS) } },
    { $set: { 'instantDispatch.status': 'expired' } }
  );

  const pending = await Lead.find({ removed: false, 'instantDispatch.status': 'pending' })
    .sort({ facebookCreatedAt: 1, created: 1 })
    .limit(10)
    .exec();
  if (!pending.length) return 0;

  const camp = await getOrCreateLeadPoolCampaign();
  const AgentCallState = mongoose.model('AgentCallState');
  const CallLead = mongoose.model('CallLead');
  const Admin = mongoose.model('Admin');
  let placed = 0;

  for (const lead of pending) {
    // Free pool agents, round-robin order.
    const states = await AgentCallState.find({ campaign: camp._id, status: 'Available' })
      .select('agent lastInstantLeadAt since')
      .lean();
    if (!states.length) break; // nobody active — wait
    const busy = await agentsOnLiveCalls(states.map((s) => s.agent));
    const free = states
      .filter((s) => !busy.has(String(s.agent)))
      .sort(
        (a, b) =>
          (a.lastInstantLeadAt ? new Date(a.lastInstantLeadAt).getTime() : 0) -
            (b.lastInstantLeadAt ? new Date(b.lastInstantLeadAt).getTime() : 0) ||
          new Date(a.since || 0).getTime() - new Date(b.since || 0).getTime()
      );
    if (!free.length) break;

    let state = null;
    let admin = null;
    for (const s of free) {
      const reserved = await reserveAgent({ agentIds: [s.agent], campaignId: camp._id });
      if (!reserved) continue; // grabbed by someone else this instant
      const a = await Admin.findById(s.agent).select('name surname phone mobile contactNumber removed enabled').lean();
      if (a && !a.removed && a.enabled !== false && last10(a.phone || a.mobile || a.contactNumber)) {
        state = reserved;
        admin = a;
        break;
      }
      await releaseAgent(s.agent);
    }
    if (!admin) break;

    const agentName = `${admin.name} ${admin.surname || ''}`.trim();
    const callLead = await new CallLead({
      campaign: camp._id,
      crmLead: lead._id,
      name: lead.name,
      phone: lead.phone,
      phoneNormalized: last10(lead.phone),
      email: lead.email || undefined,
      source: 'Facebook Instant',
      status: 'Dialing',
    }).save();

    lead.assignedUser = admin._id;
    lead.assignedUserName = agentName;
    lead.instantDispatch = {
      ...(lead.instantDispatch ? lead.instantDispatch.toObject() : {}),
      status: 'calling',
      agent: admin._id,
      agentName,
      at: lead.instantDispatch && lead.instantDispatch.at ? lead.instantDispatch.at : new Date(),
      attempts: ((lead.instantDispatch && lead.instantDispatch.attempts) || 0) + 1,
    };
    await lead.save();

    const r = await provider.placeCall({
      agent: admin,
      phone: lead.phone,
      contactName: lead.name,
      callLead: callLead._id,
      campaign: camp._id,
    });

    if (!r || !r.ok) {
      // Dial didn't go out (bad number / provider refused): give the agent
      // back, and retry later or give up after a few tries.
      await releaseAgent(admin._id);
      await CallLead.updateOne({ _id: callLead._id }, { $set: { status: 'Failed' } });
      const giveUp = lead.instantDispatch.attempts >= MAX_ATTEMPTS;
      await Lead.updateOne(
        { _id: lead._id },
        {
          $set: {
            'instantDispatch.status': giveUp ? 'expired' : 'pending',
            assignedUser: null,
            assignedUserName: '',
          },
        }
      );
      console.error('[instantLeads] dial failed for', lead.name, '-', r && r.error);
      continue;
    }

    await mongoose.model('CallRecord').updateOne({ _id: r.callRecord._id }, { $set: { instantLead: true } });
    await Lead.updateOne({ _id: lead._id }, { $set: { 'instantDispatch.callRecord': r.callRecord._id } });
    await AgentCallState.updateOne({ _id: state._id }, { $set: { lastInstantLeadAt: new Date() } });
    placed += 1;

    await broadcastAssignment(lead, agentName);
    require('../../notify')
      .notifyUser({
        recipient: admin._id,
        module: 'Calling',
        type: 'lead.instant',
        title: 'New Facebook lead — calling now',
        body: `${lead.name} (${lead.phone || ''}) is yours. Your phone is ringing.`,
        link: '/calling?tab=dialer',
      })
      .catch(() => {});
  }
  return placed;
}

// After an instant call ends (and again when the agent saves a response):
// keep the owner only if the agent actually spoke to the customer.
async function settleInstantLead(callRecord) {
  if (!callRecord || !callRecord.instantLead || !callRecord.callLead) return;
  const callLead = await mongoose.model('CallLead').findById(callRecord.callLead).select('crmLead').lean();
  if (!callLead || !callLead.crmLead) return;
  const ended = ['completed', 'failed', 'cancelled', 'transferred'].includes(callRecord.status);
  if (!ended) return;
  const spoke = callReachedCustomer(callRecord) && callRecord.agentLegAnswered !== false;
  await mongoose.model('Lead').updateOne(
    { _id: callLead.crmLead },
    {
      $set: {
        'instantDispatch.status': 'done',
        ...(spoke
          ? { assignedUser: callRecord.agent, assignedUserName: callRecord.agentName || '' }
          : { assignedUser: null, assignedUserName: '' }),
      },
    }
  );
}

module.exports = { dispatchInstantLeads, settleInstantLead };
