const mongoose = require('mongoose');
const { getOrCreateLeadPoolCampaign, last10 } = require('../services/calling/callingShared');
const { notifyUser } = require('../notify');

// Feeds the Instant Lead Pool auto-dialer (see callingController/leadPool.js)
// straight from the Sales pipeline: every lead in the ONE stage management
// picked on the Calls page (CallCampaign.leadPoolStage, default New Lead)
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

// Queues up to `limit` not-yet-queued leads of the pool's current stage.
// Returns how many leads it picked up (0 = nothing left to queue).
async function queueStageLeads(camp, limit = BATCH_LIMIT) {
  const Lead = mongoose.model('Lead');
  const CallLead = mongoose.model('CallLead');

  const stage = camp.leadPoolStage || 'New Lead';
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

  const fresh = await Lead.find({ removed: false, stage, $and: and })
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
      const n = await queueStageLeads(camp, Math.min(500, maxLeads - total));
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
  const stage = camp.leadPoolStage || 'New Lead';

  await queueStageLeads(camp);

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
