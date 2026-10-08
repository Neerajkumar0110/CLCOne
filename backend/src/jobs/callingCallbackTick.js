const mongoose = require('mongoose');
const { getProvider, callingConfig } = require('../services/calling');
const {
  reserveAgent,
  releaseAgent,
  agentsOnLiveCalls,
  withinCallingHours,
} = require('../services/calling/callingShared');
const { NON_SALES_ROLES } = require('../config/roles');

// Rings a scheduled callback at the time the agent promised, instead of
// leaving it as a row someone has to notice.
//
// This is a promise to a real person ("I'll call you at 5"), so it is
// deliberately more conservative than the campaign auto-dialer:
//
//  • it only ever calls the agent who took the callback — a callback is a
//    promise from THAT agent, so handing it to whoever happens to be free
//    would surprise the customer;
//  • it will not call while that agent is busy. The call waits until they
//    are free, rather than ringing a customer nobody can talk to;
//  • it respects the campaign's calling hours, so a callback booked for
//    10 PM goes out when calling resumes, not at 10 PM;
//  • it gives up after MAX_ATTEMPTS and leaves the row for a human.
//
// Claiming is a single findOneAndUpdate on lastDialedAt, so two overlapping
// ticks (or two processes) can never dial the same callback twice — the same
// property CloudCallProvider.tick's reserveAgent relies on.

const TICK_MS = 30 * 1000;

// Don't fire a callback that has been sitting overdue for days — at that
// point an unannounced call is worse than none.
//
// A full day, not a few hours, because the calling-hours check below can
// legitimately hold a callback overnight: a campaign's default window is
// 09:00–18:00, so a callback the agent promised for 7 PM waits until 9 AM
// the next morning, by which point it is already 14 hours overdue. A
// shorter window would silently drop exactly those.
const MAX_OVERDUE_MS = 24 * 60 * 60 * 1000;

// Wait this long before re-dialling a callback nobody picked up.
const RETRY_AFTER_MS = 15 * 60 * 1000;

const MAX_ATTEMPTS = 3;

// How many callbacks one tick may place. Each needs its own free agent
// anyway, so this is just a guard against a pathological backlog.
const PER_TICK_LIMIT = 5;

async function runCallbackTick() {
  const CallCallback = mongoose.model('CallCallback');
  const CallCampaign = mongoose.model('CallCampaign');
  const Admin = mongoose.model('Admin');
  const provider = getProvider();
  if (typeof provider.placeCall !== 'function') return 0;

  const now = new Date();
  const due = await CallCallback.find({
    removed: false,
    status: 'Pending',
    scheduledAt: { $lte: now, $gte: new Date(now.getTime() - MAX_OVERDUE_MS) },
    autoDialGaveUpAt: { $exists: false },
    assignedAgent: { $ne: null },
    dialAttempts: { $lt: MAX_ATTEMPTS },
    $or: [{ lastDialedAt: { $exists: false } }, { lastDialedAt: { $lte: new Date(now.getTime() - RETRY_AFTER_MS) } }],
  })
    .sort({ scheduledAt: 1 })
    .limit(50)
    .lean();
  if (!due.length) return 0;

  let placed = 0;

  for (const cb of due) {
    if (placed >= PER_TICK_LIMIT) break;
    if (!cb.phone) continue;

    // Calling hours belong to the campaign this callback came from; a
    // callback with no campaign (a hand-scheduled one) is unrestricted.
    if (cb.campaign) {
      const camp = await CallCampaign.findById(cb.campaign).select('callingHoursStart callingHoursEnd').lean();
      if (camp && !withinCallingHours(camp, now)) continue;
    }

    const admin = await Admin.findById(cb.assignedAgent)
      .select('name surname phone mobile contactNumber role removed enabled')
      .lean();
    if (!admin || admin.removed || admin.enabled === false || NON_SALES_ROLES.includes(admin.role)) continue;

    // The agent who owes this call has to be free right now. Checking
    // CallRecord as well as presence catches a manual or inbound call their
    // presence row doesn't know about.
    const busy = await agentsOnLiveCalls([admin._id]);
    if (busy.has(String(admin._id))) continue;

    // Atomic claim: whoever flips lastDialedAt forward owns this dial. A
    // second tick re-reading the same row fails this filter and moves on.
    const claimedCb = await CallCallback.findOneAndUpdate(
      { _id: cb._id, status: 'Pending', lastDialedAt: cb.lastDialedAt || { $exists: false } },
      { $set: { lastDialedAt: now, updated: now }, $inc: { dialAttempts: 1 } },
      { new: true }
    );
    if (!claimedCb) continue;

    // Take the agent out of the dialer's rotation for the duration, so the
    // campaign auto-dialer can't hand them a lead at the same moment.
    const reserved = await reserveAgent({ agentIds: [admin._id], campaignId: cb.campaign || null });
    if (!reserved) continue; // they went busy between the two checks

    let r;
    try {
      r = await provider.placeCall({
        agent: admin,
        phone: cb.phone,
        contactName: cb.contactName || 'Callback',
        callLead: cb.callLead || undefined,
        campaign: cb.campaign || undefined,
      });
    } catch (err) {
      r = { ok: false, error: err.message };
    }

    if (!r || !r.ok) {
      await releaseAgent(admin._id);
      if (claimedCb.dialAttempts >= MAX_ATTEMPTS) {
        await CallCallback.updateOne({ _id: cb._id }, { $set: { autoDialGaveUpAt: new Date() } });
      }
      continue;
    }

    await CallCallback.updateOne(
      { _id: cb._id },
      { $set: { callRecord: r.callRecord._id, updated: new Date() } }
    );
    placed++;
  }

  return placed;
}

function startCallingCallbackTick() {
  // The mock provider doesn't place real calls, and its own tick already
  // drives the simulation from the read endpoints.
  if (callingConfig.isMock) return;

  let running = false;
  let quietUntil = 0;
  setInterval(async () => {
    if (running) return;
    if (mongoose.connection.readyState !== 1) return;
    running = true;
    try {
      await runCallbackTick();
    } catch (err) {
      if (Date.now() > quietUntil) {
        console.error('callingCallbackTick job error:', err.message);
        quietUntil = Date.now() + 60 * 1000;
      }
    } finally {
      running = false;
    }
  }, TICK_MS);
}

module.exports = startCallingCallbackTick;
module.exports.runCallbackTick = runCallbackTick;
