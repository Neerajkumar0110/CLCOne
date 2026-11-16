const mongoose = require('mongoose');

// Ad chats nobody has spoken to yet → New Lead, first in the dialer's line
// (user ask 2026-11-16: "WhatsApp ke jitne number abhi tak contact nahi huye,
// sabko New Lead me do — jab bhi aaye, jaldi").
//
// "Contacted" = an agent actually spoke with the customer: a call to the
// number that the customer answered AND the agent joined. Everything else
// (never called, didn't pick up, busy, picked up but the agent never came on)
// is "not contacted". Such a lead is moved to New Lead and gets a pool
// CallLead at FRESH priority (dialled before everything else, retried every
// 10 min up to 5 times — leadPoolSyncTick FRESH_*). Runs for every incoming
// WhatsApp message, and for the whole backlog from the report's button.
// Never touches Invalid / Enrolled leads or a Do-Not-Call number.

// an agent decided these (Not Interested is only set after talking to them)
const SKIP_STAGES = ['Invalid Leads', 'Enrolled', 'Not Interested Leads'];
const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const phoneVariants = (ps) => [...ps, ...ps.map((p) => `91${p}`), ...ps.map((p) => `+91${p}`)];

// last10 → true for numbers an agent has spoken to
async function contactedSet(phones) {
  const ps = [...new Set(phones.map(last10).filter((p) => p.length === 10))];
  if (!ps.length) return new Set();
  const rows = await mongoose
    .model('CallRecord')
    .find({ phone: { $in: phoneVariants(ps) }, answeredAt: { $ne: null }, agentLegAnswered: true })
    .select('phone')
    .lean();
  return new Set(rows.map((r) => last10(r.phone)));
}

async function requeueLead(leadOrId, { contacted, dnc, pool, reason = 'WhatsApp chat — not contacted yet' } = {}) {
  const Lead = mongoose.model('Lead');
  const CallLead = mongoose.model('CallLead');
  const lead = leadOrId && leadOrId._id ? await Lead.findById(leadOrId._id) : await Lead.findById(leadOrId);
  if (!lead || lead.removed) return { skipped: 'no lead' };
  const p = last10(lead.phone);
  if (p.length !== 10) return { skipped: 'no phone' };
  if (SKIP_STAGES.includes(lead.stage)) return { skipped: lead.stage };
  // a call logged on the lead itself as connected (e.g. from the agent's own mobile) counts as contacted
  if ((lead.callHistory || []).some((c) => /connect/i.test(c.outcome || ''))) return { skipped: 'contacted' };
  const sync = require('../../jobs/leadPoolSyncTick');
  const dncList = dnc || (await sync.dncPhones());
  if (dncList.includes(p)) return { skipped: 'DNC' };
  const spoke = contacted ? contacted.has(p) : (await contactedSet([p])).has(p);
  if (spoke) return { skipped: 'contacted' };

  // 1) stage → New Lead (with an audit line, like any system move)
  let moved = false;
  if (lead.stage !== 'New Lead') {
    const { defaultSubStatus } = require('../../config/leadStages');
    const sub = defaultSubStatus('New Lead');
    lead.stageHistory = lead.stageHistory || [];
    lead.stageHistory.push({ fromStage: lead.stage, fromSubStatus: lead.subStatus, toStage: 'New Lead', toSubStatus: sub, changedByName: 'System', remarks: reason, at: new Date() });
    lead.stage = 'New Lead';
    lead.subStatus = sub;
    lead.stageUpdatedAt = new Date();
    moved = true;
  }
  lead.autoDialerQueuedAt = new Date();
  await lead.save();

  // 2) first in the dialer's line
  const camp = pool || (await require('../calling/callingShared').getOrCreateLeadPoolCampaign());
  const waiting = await CallLead.findOne({ campaign: camp._id, removed: false, phoneNormalized: p, status: { $in: ['New', 'Queued', 'Dialing'] } });
  if (waiting) {
    if (waiting.status !== 'Dialing' && waiting.priority !== sync.FRESH_PRIORITY) {
      await CallLead.updateOne({ _id: waiting._id }, { $set: { priority: sync.FRESH_PRIORITY, nextAttemptAt: null, crmLead: lead._id } });
      return { moved, queued: 'bumped' };
    }
    return { moved, queued: 'already first' };
  }
  await CallLead.create({
    campaign: camp._id,
    crmLead: lead._id,
    name: lead.name,
    phone: lead.phone,
    phoneNormalized: p,
    email: lead.email || undefined,
    source: 'CRM Lead Pool (WhatsApp chat)',
    status: 'New',
    priority: sync.FRESH_PRIORITY,
  });
  return { moved, queued: 'added' };
}

// Every chat lead of a channel nobody has spoken to → New Lead + first in line.
async function requeueAllUncontacted(channel = 'whatsapp') {
  const Lead = mongoose.model('Lead');
  const leads = await Lead.find({ removed: false, chatChannel: channel, chatConversationId: { $exists: true, $ne: null }, phone: { $nin: [null, ''] } })
    .select('_id phone stage')
    .lean();
  const contacted = await contactedSet(leads.map((l) => l.phone));
  const dnc = await require('../../jobs/leadPoolSyncTick').dncPhones();
  const pool = await require('../calling/callingShared').getOrCreateLeadPoolCampaign();
  const out = { total: leads.length, contacted: 0, moved: 0, added: 0, bumped: 0, alreadyFirst: 0, skipped: {} };
  for (const l of leads) {
    if (contacted.has(last10(l.phone))) {
      out.contacted += 1;
      continue;
    }
    const r = await requeueLead(l, { contacted, dnc, pool, reason: `${channel} chat — not contacted yet (bulk)` });
    if (r.skipped) out.skipped[r.skipped] = (out.skipped[r.skipped] || 0) + 1;
    if (r.moved) out.moved += 1;
    if (r.queued === 'added') out.added += 1;
    if (r.queued === 'bumped') out.bumped += 1;
    if (r.queued === 'already first') out.alreadyFirst += 1;
  }
  return out;
}

// An incoming WhatsApp message (webhook) — never throws.
async function onChat(lead) {
  try {
    if (!lead || !lead.phone) return null;
    return await requeueLead(lead);
  } catch (e) {
    console.error('[chat dial queue]', e.message);
    return null;
  }
}

module.exports = { contactedSet, requeueLead, requeueAllUncontacted, onChat, SKIP_STAGES };
