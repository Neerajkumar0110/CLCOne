const mongoose = require('mongoose');
const { getOrCreateLeadPoolCampaign, last10 } = require('../services/calling/callingShared');
const { notifyUser } = require('../notify');

// Feeds the Instant Lead Pool auto-dialer (see callingController/leadPool.js)
// straight from the Sales pipeline: the leads of the stages management
// picked on the Calls page, in priority order (CallCampaign.leadPoolStages;
// leadPoolStage = the one dialing now — see advanceAndQueue below)
// gets queued as a CallLead in the one system campaign, pre-linked back to
// the real Lead via `crmLead` so a call outcome rolls the original Lead's own
// stage forward instead of spawning a duplicate (see callingShared.js's
// resolveLead/advanceCrmLead).
//
// New Lead keeps its old rule — only UNASSIGNED leads are swept in (once a
// rep has a fresh lead assigned, it's theirs to work by hand). Any other
// stage was picked deliberately by management, so every lead in it is
// dialed, assigned or not.
//
// A lead is queued once per stage pick: autoDialerQueuedAt older than
// leadPoolStageSetAt (or never set) means "not yet queued under the current
// pick". There is no automatic re-dial — an unreached lead stays where it is
// until management points the pool at its stage again.
const TICK_MS = 30 * 1000;
const BATCH_LIMIT = 200;

const stagesOf = (camp) => {
  const list = (camp.leadPoolStages || []).filter(Boolean);
  return list.length ? list : [camp.leadPoolStage || 'New Lead'];
};

// The Lead filter for "not yet queued under the current pick" in one stage.
function stageLeadFilter(camp, stage) {
  const and = [];
  if (stage === 'New Lead') {
    and.push({ $or: [{ assignedUser: null }, { assignedUser: { $exists: false } }] });
  }
  and.push({
    $or: [
      { autoDialerQueuedAt: null },
      ...(camp.leadPoolStageSetAt ? [{ autoDialerQueuedAt: { $lt: camp.leadPoolStageSetAt } }] : []),
    ],
  });
  return { removed: false, stage, $and: and };
}

// Queues up to `limit` not-yet-queued leads of one stage.
// Returns how many leads it picked up (0 = nothing left to queue).
async function queueStageLeads(camp, stage, limit = BATCH_LIMIT) {
  const Lead = mongoose.model('Lead');
  const CallLead = mongoose.model('CallLead');

  const fresh = await Lead.find(stageLeadFilter(camp, stage))
    .select('_id name phone email')
    .limit(limit)
    .lean();
  if (!fresh.length) return 0;

  const docs = fresh
    .filter((l) => last10(l.phone).length >= 8)
    .map((l) => ({
      campaign: camp._id,
      crmLead: l._id,
      name: l.name,
      phone: l.phone,
      phoneNormalized: last10(l.phone),
      email: l.email || undefined,
      source: stage === 'New Lead' ? 'CRM Lead Pool' : `CRM Lead Pool (${stage})`,
      status: 'New',
    }));
  if (docs.length) {
    await CallLead.insertMany(docs, { ordered: false }).catch(() => {});
  }
  await Lead.updateMany({ _id: { $in: fresh.map((l) => l._id) } }, { $set: { autoDialerQueuedAt: new Date() } });
  return fresh.length;
}

// Multi-stage priority: while the active stage still has leads waiting in
// the queue, keep topping it up. Once the queue is empty, walk the picked
// stages in order and queue from the FIRST one that has leads left — so the
// first pick always wins (new New Leads arriving pull the pool back to it)
// and a finished stage hands over to the next automatically.
// A lead queued once under the current pick is never queued again in the
// same pick (autoDialerQueuedAt), even if its call moved it into a later
// picked stage — no double dials.
async function advanceAndQueue(camp, limit = BATCH_LIMIT) {
  const CallLead = mongoose.model('CallLead');
  const active = camp.leadPoolStage || 'New Lead';
  const pending = await CallLead.countDocuments({ campaign: camp._id, removed: false, status: { $in: ['New', 'Queued'] } });
  if (pending > 0) {
    return { stage: active, queued: await queueStageLeads(camp, active, limit) };
  }
  for (const stage of stagesOf(camp)) {
    const queued = await queueStageLeads(camp, stage, limit);
    if (queued) {
      if (stage !== active) {
        await mongoose
          .model('CallCampaign')
          .updateOne({ _id: camp._id }, { $set: { leadPoolStage: stage, leadPoolStageActiveAt: new Date() } });
        camp.leadPoolStage = stage;
      }
      return { stage, queued };
    }
  }
  return { stage: active, queued: 0 };
}

// Leads still to dial per picked stage (for the Calls page) — cached ~15s,
// the status endpoint is polled by every agent.
let _queueCache = { at: 0, key: '', value: null };
async function stageQueueSummary(camp) {
  const key = `${stagesOf(camp).join('|')}#${camp.leadPoolStage}#${camp.leadPoolStageSetAt ? new Date(camp.leadPoolStageSetAt).getTime() : 0}`;
  if (_queueCache.value && _queueCache.key === key && Date.now() - _queueCache.at < 15000) return _queueCache.value;
  const Lead = mongoose.model('Lead');
  const CallLead = mongoose.model('CallLead');
  const pending = await CallLead.countDocuments({ campaign: camp._id, removed: false, status: { $in: ['New', 'Queued'] } });
  const active = camp.leadPoolStage || 'New Lead';
  const value = [];
  for (const stage of stagesOf(camp)) {
    const notQueued = await Lead.countDocuments(stageLeadFilter(camp, stage));
    value.push({ stage, left: notQueued + (stage === active ? pending : 0), active: stage === active });
  }
  _queueCache = { at: Date.now(), key, value };
  return value;
}

// The tick and setStage's immediate fill share this lock, so the two can
// never queue the same lead twice by racing each other.
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

// Called right after management changes the pool's stage (leadPool.js
// setStage) so the new stage's leads are waiting at once, instead of
// trickling in 200 per 30-second tick while the page says the pool is empty.
function fillLeadPoolNow(maxLeads = 5000) {
  return withLock(async () => {
    const camp = await getOrCreateLeadPoolCampaign();
    let total = 0;
    while (total < maxLeads) {
      const { queued: n } = await advanceAndQueue(camp, Math.min(500, maxLeads - total));
      total += n;
      if (!n) break;
    }
    if (total) {
      await mongoose.model('CallCampaign').updateOne({ _id: camp._id }, { $set: { leadsExhaustedNotifiedAt: null } });
    }
    return total;
  });
}

async function tick() {
  const camp = await getOrCreateLeadPoolCampaign();
  const CallLead = mongoose.model('CallLead');
  const CallCampaign = mongoose.model('CallCampaign');
  await advanceAndQueue(camp);
  const stage = stagesOf(camp).join(', ');

  const pending = await CallLead.countDocuments({
    campaign: camp._id,
    removed: false,
    status: { $in: ['New', 'Queued'] },
  });

  if (pending === 0) {
    if (!camp.leadsExhaustedNotifiedAt) {
      const AgentCallState = mongoose.model('AgentCallState');
      const participants = await AgentCallState.find({ campaign: camp._id, status: 'Available' })
        .select('agent')
        .lean();
      for (const p of participants) {
        await notifyUser({
          recipient: p.agent,
          module: 'Calling',
          type: 'leadpool.exhausted',
          title: 'Instant Lead Pool is empty',
          body: `No ${stage} leads left to dial right now — it will pick up automatically as new ones come in.`,
          link: '/calling?tab=dialer',
        });
      }
      await CallCampaign.updateOne({ _id: camp._id }, { $set: { leadsExhaustedNotifiedAt: new Date() } });
    }
  } else if (camp.leadsExhaustedNotifiedAt) {
    await CallCampaign.updateOne({ _id: camp._id }, { $set: { leadsExhaustedNotifiedAt: null } });
  }
}

function startLeadPoolSyncTick() {
  setInterval(() => {
    if (mongoose.connection.readyState !== 1) return;
    withLock(() => tick().catch((err) => console.error('leadPoolSyncTick job error:', err.message)));
  }, TICK_MS);
}

module.exports = startLeadPoolSyncTick;
module.exports.fillLeadPoolNow = fillLeadPoolNow;
module.exports.stageQueueSummary = stageQueueSummary;
module.exports.stagesOf = stagesOf;
module.exports.advanceAndQueue = advanceAndQueue;
