const mongoose = require('mongoose');
const { getOrCreateLeadPoolCampaign, last10 } = require('../services/calling/callingShared');
const { notifyUser } = require('../notify');

// Feeds the Instant Lead Pool auto-dialer (see callingController/leadPool.js)
// straight from the Sales pipeline: any fresh, UNASSIGNED "New Lead" gets
// queued as a CallLead in the one system campaign, pre-linked back to the
// real Lead via `crmLead` so a call outcome rolls the original Lead's own
// stage forward instead of spawning a duplicate (see callingShared.js's
// resolveLead/advanceCrmLead). Only unassigned leads are swept in — once a
// rep has a lead assigned to them, it's theirs to work by hand, not fair
// game for whichever agent happens to be free in the shared pool.
const TICK_MS = 30 * 1000;
const BATCH_LIMIT = 200;

function startLeadPoolSyncTick() {
  let running = false;
  setInterval(async () => {
    if (running) return;
    if (mongoose.connection.readyState !== 1) return;
    running = true;
    try {
      const camp = await getOrCreateLeadPoolCampaign();
      const Lead = mongoose.model('Lead');
      const CallLead = mongoose.model('CallLead');
      const CallCampaign = mongoose.model('CallCampaign');

      const fresh = await Lead.find({
        removed: false,
        stage: 'New Lead',
        autoDialerQueuedAt: null,
        $or: [{ assignedUser: null }, { assignedUser: { $exists: false } }],
      })
        .select('_id name phone email')
        .limit(BATCH_LIMIT)
        .lean();

      if (fresh.length) {
        const docs = fresh
          .filter((l) => last10(l.phone).length >= 8)
          .map((l) => ({
            campaign: camp._id,
            crmLead: l._id,
            name: l.name,
            phone: l.phone,
            phoneNormalized: last10(l.phone),
            email: l.email || undefined,
            source: 'CRM Lead Pool',
            status: 'New',
          }));
        if (docs.length) {
          await CallLead.insertMany(docs, { ordered: false }).catch(() => {});
        }
        await Lead.updateMany(
          { _id: { $in: fresh.map((l) => l._id) } },
          { $set: { autoDialerQueuedAt: new Date() } }
        );
      }

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
              body: 'No New leads left to dial right now — it will pick up automatically as fresh leads come in.',
              link: '/calling?tab=dialer',
            });
          }
          await CallCampaign.updateOne({ _id: camp._id }, { $set: { leadsExhaustedNotifiedAt: new Date() } });
        }
      } else if (camp.leadsExhaustedNotifiedAt) {
        await CallCampaign.updateOne({ _id: camp._id }, { $set: { leadsExhaustedNotifiedAt: null } });
      }
    } catch (err) {
      console.error('leadPoolSyncTick job error:', err.message);
    } finally {
      running = false;
    }
  }, TICK_MS);
}

module.exports = startLeadPoolSyncTick;
