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
//    would surprise the customer. The one exception is a callback nobody
//    owns (a missed incoming call no user was tied to): the first user who
//    is free takes it and it becomes theirs;
//  • a minute before it's due, that user gets no new auto-dialer call
//    (callbackHolds), so the callback goes out on time — or, if they're
//    mid-call, the moment that call ends, before any auto-dialer call;
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

// From this long before a callback is due, its user gets no new auto-dialer
// / pool / Facebook-lead call — so they're free the moment it's time. If
// they're mid-call then, the callback goes out the moment that call ends
// (and its outcome is submitted), before any auto-dialer call.
const HOLD_BEFORE_MS = 60 * 1000;

// Callbacks that may be dialled `ahead` ms from now.
function dueFilter(now, ahead = 0) {
  return {
    removed: false,
    status: 'Pending',
    scheduledAt: { $lte: new Date(now.getTime() + ahead), $gte: new Date(now.getTime() - MAX_OVERDUE_MS) },
    autoDialGaveUpAt: { $exists: false },
    dialAttempts: { $lt: MAX_ATTEMPTS },
    $or: [{ lastDialedAt: { $exists: false } }, { lastDialedAt: { $lte: new Date(now.getTime() - RETRY_AFTER_MS + ahead) } }],
  };
}

// Who the auto-dialer must leave alone right now: users with a callback due
// within the minute, and how many due callbacks belong to nobody (a missed
// incoming call no user was tied to — the next free user takes it, so the
// auto-dialer starts no new line while one waits).
async function callbackHolds(now = new Date()) {
  const rows = await mongoose.model('CallCallback').find(dueFilter(now, HOLD_BEFORE_MS)).select('assignedAgent').lean();
  return {
    agents: new Set(rows.filter((r) => r.assignedAgent).map((r) => String(r.assignedAgent))),
    unassigned: rows.filter((r) => !r.assignedAgent).length,
  };
}

const usableAdmin = (a) => a && !a.removed && a.enabled !== false && !NON_SALES_ROLES.includes(a.role) && (a.phone || a.mobile || a.contactNumber);

async function runCallbackTick() {
  const CallCallback = mongoose.model('CallCallback');
  const CallCampaign = mongoose.model('CallCampaign');
  const Admin = mongoose.model('Admin');
  const AgentCallState = mongoose.model('AgentCallState');
  const provider = getProvider();
  if (typeof provider.placeCall !== 'function') return 0;

  const now = new Date();
  // Own callbacks first (a promise from that user), then the ones nobody
  // owns, oldest first.
  const due = await CallCallback.find(dueFilter(now)).sort({ scheduledAt: 1 }).limit(50).lean();
  if (!due.length) return 0;
  due.sort((a, b) => (a.assignedAgent ? 0 : 1) - (b.assignedAgent ? 0 : 1));

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

    // Who can take it: the user who owes it — or, for a missed incoming
    // call tied to nobody, whoever has been free the longest.
    let candidates;
    if (cb.assignedAgent) {
      const owner = await Admin.findById(cb.assignedAgent).select('name surname phone mobile contactNumber role removed enabled').lean();
      if (!usableAdmin(owner)) continue;
      candidates = [owner._id];
    } else {
      const free = await AgentCallState.find({ status: 'Available', awaitingOutcome: null }).sort({ since: 1 }).select('agent').lean();
      candidates = free.map((s) => s.agent);
    }
    // Free right now? CallRecord as well as presence catches a manual or
    // inbound call their presence row doesn't know about.
    const busy = await agentsOnLiveCalls(candidates);
    candidates = candidates.filter((id) => !busy.has(String(id)));
    if (!candidates.length) continue;

    // Take the user out of the dialer's rotation FIRST, so the auto-dialer
    // can't hand them a lead at the same moment — and so a user who just
    // went busy doesn't cost the callback an attempt and a 15-minute wait.
    let reserved = null;
    let admin = null;
    for (let i = 0; i < 5 && candidates.length; i++) {
      reserved = await reserveAgent({ agentIds: candidates, campaignId: cb.campaign || null });
      if (!reserved) break;
      admin = await Admin.findById(reserved.agent).select('name surname phone mobile contactNumber role removed enabled').lean();
      if (usableAdmin(admin)) break;
      await releaseAgent(reserved.agent);
      candidates = candidates.filter((id) => String(id) !== String(reserved.agent));
      reserved = null;
      admin = null;
    }
    if (!reserved || !admin) continue;

    // Atomic claim: whoever flips lastDialedAt forward owns this dial. A
    // second tick re-reading the same row fails this filter and moves on.
    const claimedCb = await CallCallback.findOneAndUpdate(
      { _id: cb._id, status: 'Pending', lastDialedAt: cb.lastDialedAt || { $exists: false } },
      {
        $set: {
          lastDialedAt: now,
          updated: now,
          ...(cb.assignedAgent ? {} : { assignedAgent: admin._id, assignedAgentName: `${admin.name} ${admin.surname || ''}`.trim() }),
        },
        $inc: { dialAttempts: 1 },
      },
      { new: true }
    );
    if (!claimedCb) {
      await releaseAgent(admin._id);
      continue;
    }

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

// The auto-dialled callback call is over (cloudWebhook): if the user
// actually spoke to the customer the promise is kept → Done, instead of
// being dialled again 15 minutes later (it used to stay Pending and ring
// the customer up to 3 times). Not if it was rescheduled during the call
// (scheduledAt moved past the dial).
async function settleCallbackCall(rec) {
  if (!rec || !rec.agent || !rec.answeredAt || !rec.agentLegAnswered) return;
  await mongoose.model('CallCallback').updateMany(
    { callRecord: rec._id, status: 'Pending', lastDialedAt: { $ne: null }, $expr: { $lte: ['$scheduledAt', '$lastDialedAt'] } },
    { $set: { status: 'Done', completedAt: new Date(), updated: new Date() } }
  );
}

// One lock for both callers: the 30s interval below AND CloudCallProvider.
// tick(), which runs this FIRST every pass (before instant leads and the
// pool) so a due callback goes out the moment its agent is free again —
// e.g. the second their current call ends — instead of the pool grabbing
// them for the next customer.
let running = false;
let quietUntil = 0;
async function runCallbackTickSafe() {
  if (callingConfig.isMock) return 0;
  if (running || mongoose.connection.readyState !== 1) return 0;
  running = true;
  try {
    return await runCallbackTick();
  } catch (err) {
    if (Date.now() > quietUntil) {
      console.error('callingCallbackTick job error:', err.message);
      quietUntil = Date.now() + 60 * 1000;
    }
    return 0;
  } finally {
    running = false;
  }
}

function startCallingCallbackTick() {
  // The mock provider doesn't place real calls, and its own tick already
  // drives the simulation from the read endpoints.
  if (callingConfig.isMock) return;
  setInterval(runCallbackTickSafe, TICK_MS);
}

module.exports = startCallingCallbackTick;
module.exports.runCallbackTickSafe = runCallbackTickSafe;
module.exports.runCallbackTick = runCallbackTick;
module.exports.callbackHolds = callbackHolds;
module.exports.settleCallbackCall = settleCallbackCall;
