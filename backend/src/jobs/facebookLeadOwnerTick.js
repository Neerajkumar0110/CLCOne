const mongoose = require('mongoose');

// Facebook leads — who owns them, and where the unreached ones go.
//
// 1. Contacted → owner: a Facebook lead nobody owns, that a user has
//    actually spoken to (an answered call that agent took), is assigned to
//    the user who last spoke to it. Covers every call path — instant,
//    Lead Pool, manual — not just the instant call (instantLeads.js already
//    does it there).
// 2. Unassigned for 24h → Fresh Leads: a Facebook lead still with no owner
//    a day after it came in moves to the Fresh Leads stage, once
//    (facebookFreshAt), so the Lead Pool can redial it. Whatever happens to
//    it after that is left alone.
const TICK_MS = Number(process.env.FACEBOOK_LEAD_OWNER_TICK_MS || 5 * 60 * 1000);
const FRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const FRESH = { stage: 'Fresh Leads', subStatus: 'Old Leads reassignment or Stage wise Dialing' };

const tail = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const unowned = { $or: [{ assignedUser: null }, { assignedUser: { $exists: false } }] };
const facebook = { removed: false, facebookLeadId: { $exists: true, $ne: null } };

async function assignContacted() {
  const Lead = mongoose.model('Lead');
  const leads = await Lead.find({ ...facebook, ...unowned, 'instantDispatch.status': { $nin: ['pending', 'calling'] } })
    .select('phone phoneNormalized')
    .lean();
  const byTail = new Map(leads.map((l) => [l.phoneNormalized || tail(l.phone), l._id]).filter(([t]) => t.length === 10));
  if (!byTail.size) return 0;

  const calls = await mongoose
    .model('CallRecord')
    .find({ removed: { $ne: true }, answeredAt: { $ne: null }, agent: { $ne: null }, phone: { $regex: `(${[...byTail.keys()].join('|')})$` } })
    .select('phone agent agentName answeredAt')
    .sort({ answeredAt: -1 })
    .lean();
  let n = 0;
  const done = new Set();
  for (const c of calls) {
    const t = tail(c.phone);
    if (done.has(t) || !byTail.has(t)) continue;
    done.add(t);
    const r = await Lead.updateOne(
      { _id: byTail.get(t), ...unowned },
      { $set: { assignedUser: c.agent, assignedUserName: c.agentName || '' }, $max: { lastContactAt: c.answeredAt } }
    );
    n += r.modifiedCount || 0;
  }
  return n;
}

async function moveUnassignedToFresh() {
  const Lead = mongoose.model('Lead');
  const cutoff = new Date(Date.now() - FRESH_AFTER_MS);
  const leads = await Lead.find({
    ...facebook,
    ...unowned,
    facebookFreshAt: { $exists: false },
    'instantDispatch.status': { $nin: ['pending', 'calling'] },
    $and: [{ $or: [{ facebookCreatedAt: { $lt: cutoff } }, { facebookCreatedAt: { $exists: false }, created: { $lt: cutoff } }] }],
  }).limit(500);
  let n = 0;
  for (const lead of leads) {
    const from = { stage: lead.stage, subStatus: lead.subStatus };
    lead.facebookFreshAt = new Date();
    if (lead.stage !== FRESH.stage) {
      lead.stage = FRESH.stage;
      lead.subStatus = FRESH.subStatus;
      lead.stageHistory.push({
        fromStage: from.stage,
        fromSubStatus: from.subStatus,
        toStage: FRESH.stage,
        toSubStatus: FRESH.subStatus,
        remarks: 'Facebook lead not assigned to any user within 24 hours — moved to Fresh Leads (automatic)',
        at: new Date(),
      });
      n += 1;
    }
    await lead.save();
  }
  return n;
}

async function runOnce() {
  try {
    const assigned = await assignContacted();
    const fresh = await moveUnassignedToFresh();
    if (assigned || fresh) console.log(`[facebookLeadOwner] assigned ${assigned} contacted lead(s), moved ${fresh} to Fresh Leads`);
    return { assigned, fresh };
  } catch (e) {
    console.error('[facebookLeadOwner] tick failed:', e.message);
    return null;
  }
}

function start() {
  setTimeout(runOnce, 90 * 1000);
  setInterval(runOnce, TICK_MS);
  console.log('[facebookLeadOwner] tick — every', Math.round(TICK_MS / 60000), 'min');
}

start.runOnce = runOnce;
module.exports = start;
