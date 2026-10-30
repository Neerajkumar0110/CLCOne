const mongoose = require('mongoose');
const {
  getOrCreateLeadPoolCampaign,
  agentsOnLiveCalls,
  reserveAgent,
  releaseAgent,
  callReachedCustomer,
  last10,
} = require('./callingShared');
const { NON_SALES_ROLES } = require('../../config/roles');

// Instant call for a fresh Facebook lead.
//
// The moment a new lead lands from a Facebook Lead Ad (facebookController/
// webhook.js processWebhookLog marks it instantDispatch.status='pending'),
// the next CloudCallProvider.tick() hands it to the FIRST user who is free —
// any Sales user with the dialer on (Lead Pool or any campaign), Available
// and not on a call — and dials it right away (customer first, then that
// agent's phone, like every cloud call). No round-robin: whoever has been
// free longest takes it.
//
// Priority over the auto-dialer: tick() dispatches these before any
// campaign dialing, and while one is waiting (instantLeadsWaiting) the
// auto-dialer starts no new lines, so the next user whose call ends gets the
// Facebook lead instead of another auto-dialer lead.
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
// How long a waiting lead may hold the auto-dialer back. A lead that still
// can't be placed after this (e.g. every free user has no phone number)
// keeps first call on the next free user, but stops pausing everyone else.
const HOLD_MS = Number(process.env.INSTANT_LEAD_HOLD_MS || 10 * 60 * 1000);

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
    // Every free user with the dialer on, whichever campaign — longest free
    // first. (The connect mode isn't a filter here: plivoAnswer rings the
    // mobile for anyone whose line / browser phone isn't ready.)
    const states = await AgentCallState.find({ status: 'Available', awaitingOutcome: null })
      .select('agent since')
      .sort({ since: 1 })
      .lean();
    if (!states.length) break; // nobody free — wait
    const busy = await agentsOnLiveCalls(states.map((s) => s.agent));
    // a callback due within the minute keeps its user for that
    const { agents: held } = await require('../../jobs/callingCallbackTick').callbackHolds();
    const free = states.filter((s) => !busy.has(String(s.agent)) && !held.has(String(s.agent)));
    if (!free.length) break;

    let state = null;
    let admin = null;
    for (const s of free) {
      // No campaignId: AgentCallState.campaign is the user's campaign / pool
      // membership — taking a Facebook lead must not move them out of it.
      const reserved = await reserveAgent({ agentIds: [s.agent], campaignId: null });
      if (!reserved) continue; // grabbed by someone else this instant
      const a = await Admin.findById(s.agent).select('name surname phone mobile contactNumber role removed enabled').lean();
      if (
        a &&
        !a.removed &&
        a.enabled !== false &&
        !NON_SALES_ROLES.includes(a.role) &&
        last10(a.phone || a.mobile || a.contactNumber)
      ) {
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

// Fresh Facebook leads still waiting for a free user — while any are, the
// auto-dialer places no new lines (CloudCallProvider.tick step 3).
async function instantLeadsWaiting() {
  return mongoose.model('Lead').countDocuments({
    removed: false,
    'instantDispatch.status': 'pending',
    'instantDispatch.at': { $gte: new Date(Date.now() - HOLD_MS) },
  });
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

module.exports = { dispatchInstantLeads, instantLeadsWaiting, settleInstantLead };
