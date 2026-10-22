const mongoose = require('mongoose');
const { callReachedCustomer, last10 } = require('../calling/callingShared');
const { fixMojibake } = require('../../utils/fixMojibake');

// Advanced Reporting → Number Lookup: everything the CRM knows about one
// customer — found by phone (any format), email, or name. Lead(s) + every
// call (current CallRecord and the older Call log) with who spoke, when,
// how long, the response and notes, plus the pool queue, callbacks, demos,
// payments, finance KYC and support tickets — and a per-user summary.

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plain = (s) => (fixMojibake(s) || '').normalize('NFKC').trim();
// Drop the dialer's own stamp from call notes — keep what the agent wrote.
const cleanNotes = (n) => {
  const t = String(n || '')
    .replace(/Instant Lead Pool\s*[—-]\s*agent assigned on answer\.?/gi, '')
    .replace(/^[A-Z_]{3,}\s*[—-]\s*/, '')
    .replace(/\s*[—-]\s*(\n|$)/g, '$1')
    .trim();
  return t || null;
};
const LEAD_FIELDS =
  'name phone phoneNormalized alternatePhone email city state country source metaFormName facebookCreatedAt stage subStatus assignedUserName team persona age gender highestQualification education profile currentCtc painPoint preferredLanguage budgetRange howSoonToStart message remarks meetingAt callBackAt futureFollowUpAt enrolledAt created updated stageHistory callHistory ownerHistory';

// Name / email search → a short pick-list; a phone search goes straight in.
async function findCandidates(q) {
  const Lead = mongoose.model('Lead');
  const text = String(q || '').trim();
  if (!text) return [];
  const filter = text.includes('@')
    ? { removed: false, email: new RegExp(`^${esc(text)}$`, 'i') }
    : { removed: false, name: new RegExp(esc(text), 'i') };
  const rows = await Lead.find(filter).select('name phone email stage subStatus assignedUserName').limit(25).lean();
  return rows.map((l) => ({ id: String(l._id), name: plain(l.name), phone: l.phone, email: l.email, stage: l.stage, subStatus: l.subStatus, owner: l.assignedUserName }));
}

async function build(q) {
  const text = String(q || '').trim();
  const digits = text.replace(/\D/g, '');
  let p10 = digits.length >= 7 ? last10(digits) : '';

  // Not a number → email / name: pick-list, or straight in when there's one match.
  if (!p10) {
    const cands = await findCandidates(text);
    if (cands.length !== 1) return { candidates: cands };
    p10 = last10(cands[0].phone);
    if (!p10) return { candidates: cands };
  }
  const tail = new RegExp(`${esc(p10)}$`);

  const [leads, calls, legacy, queue, callbacks, demos, tickets] = await Promise.all([
    mongoose
      .model('Lead')
      .find({ removed: false, $or: [{ phoneNormalized: p10 }, { alternatePhone: tail }] })
      .select(LEAD_FIELDS)
      .lean(),
    mongoose
      .model('CallRecord')
      .find({ removed: false, phone: tail })
      .select('contactName phone status disposition notes duration missedByAgent agentLegAnswered agent agentName created answeredAt endedAt campaign instantLead direction connectMode recording')
      .sort({ created: -1 })
      .lean(),
    mongoose.model('Call').find({ removed: false, phone: tail }).select('phone contactName calledBy team status duration notes created').sort({ created: -1 }).lean().catch(() => []),
    mongoose.model('CallLead').find({ removed: false, phoneNormalized: p10 }).select('status attempts lastDisposition source lastAttemptAt created').lean(),
    mongoose.model('CallCallback').find({ removed: false, phone: tail }).select('scheduledAt status assignedAgentName notes completedAt created').sort({ scheduledAt: -1 }).lean(),
    mongoose.model('DemoBooking').find({ removed: false, phone: tail }).select('date status agentName teamLeaderName attendedAt rebookCount missedDates created').sort({ created: -1 }).lean(),
    mongoose.model('Ticket').find({ removed: { $ne: true }, raisedByPhone: tail }).select('subject status category created raisedByName').sort({ created: -1 }).lean().catch(() => []),
  ]);
  const emails = [...new Set(leads.map((l) => (l.email || '').toLowerCase()).filter(Boolean))];
  const payOr = [{ studentPhone: tail }, ...(emails.length ? [{ studentEmail: { $in: emails } }] : [])];
  const [payments, finance] = await Promise.all([
    mongoose.model('PaymentRequest').find({ removed: false, $or: payOr }).select('studentName amount status paidAt course installmentNo installmentCount createdByName created').sort({ created: -1 }).lean(),
    mongoose.model('FinanceApplication').find({ removed: false, $or: payOr }).select('studentName course financeAmount tenureMonths status createdByName created kycSubmittedAt').sort({ created: -1 }).lean(),
  ]);

  const pool = await mongoose.model('CallCampaign').findOne({ isLeadPool: true, removed: false }).select('_id').lean();
  const typeOf = (r) => (r.instantLead ? 'Facebook lead' : r.direction === 'Inbound' ? 'Inbound' : pool && String(r.campaign) === String(pool._id) ? 'Lead pool' : 'Dialer');
  const outcomeOf = (r) => (r.missedByAgent ? 'Missed by agent' : callReachedCustomer(r) ? 'Connected' : 'Not picked up');

  const callRows = calls.map((c) => ({
    id: String(c._id),
    at: c.created,
    agent: c.agentName || null,
    type: typeOf(c),
    direction: c.direction || 'Outbound',
    outcome: outcomeOf(c),
    durationSec: c.duration || 0,
    disposition: c.disposition || null,
    notes: cleanNotes(c.notes),
    recordingUrl: c.recording && c.recording.status === 'available' ? c.recording.url : null,
    source: 'cloud',
  }));
  const legacyRows = legacy.map((c) => ({
    id: String(c._id),
    at: c.created,
    agent: c.calledBy || null,
    type: 'Earlier calls',
    direction: 'Outbound',
    outcome: c.status === 'Connected' ? 'Connected' : c.status || 'Not picked up',
    durationSec: c.duration || 0,
    disposition: null,
    notes: c.notes || null,
    recordingUrl: null,
    source: 'legacy',
  }));
  const allCalls = [...callRows, ...legacyRows].sort((a, b) => new Date(b.at) - new Date(a.at));

  // Per user: how often, how long, first and last, what they recorded.
  const byUser = new Map();
  const userRow = (name) => {
    const k = name || 'Unassigned';
    if (!byUser.has(k)) byUser.set(k, { user: k, calls: 0, connected: 0, talkSeconds: 0, longest: 0, first: null, last: null, dispositions: {}, stageMoves: 0 });
    return byUser.get(k);
  };
  for (const c of allCalls) {
    const u = userRow(c.agent);
    u.calls += 1;
    if (c.outcome === 'Connected') u.connected += 1;
    u.talkSeconds += c.durationSec;
    u.longest = Math.max(u.longest, c.durationSec);
    if (!u.first || new Date(c.at) < new Date(u.first)) u.first = c.at;
    if (!u.last || new Date(c.at) > new Date(u.last)) u.last = c.at;
    if (c.disposition) u.dispositions[c.disposition] = (u.dispositions[c.disposition] || 0) + 1;
  }
  for (const l of leads) for (const h of l.stageHistory || []) if (h.changedByName) userRow(h.changedByName).stageMoves += 1;

  const connected = allCalls.filter((c) => c.outcome === 'Connected');
  const lead = leads.sort((a, b) => new Date(b.updated || b.created) - new Date(a.updated || a.created))[0] || null;

  // One merged story, newest first.
  const events = [];
  for (const l of leads) {
    events.push({ at: l.facebookCreatedAt || l.created, kind: 'lead', text: `Lead created${l.source ? ` · ${l.source}` : ''}${l.metaFormName ? ` · ${l.metaFormName}` : ''}` });
    for (const h of l.stageHistory || [])
      events.push({ at: h.at, kind: 'stage', by: h.changedByName || 'System', from: h.fromStage || null, to: h.toStage, sub: h.toSubStatus || null, text: h.remarks || '' });
    for (const o of l.ownerHistory || []) if (o && o.at) events.push({ at: o.at, kind: 'owner', by: o.byName || null, text: `Owner → ${o.toName || o.name || '—'}` });
  }
  for (const c of allCalls) events.push({ at: c.at, kind: 'call', by: c.agent, outcome: c.outcome, durationSec: c.durationSec, disposition: c.disposition, text: c.notes || '', callType: c.type });
  for (const cb of callbacks) events.push({ at: cb.created, kind: 'callback', by: cb.assignedAgentName, text: `Callback for ${new Date(cb.scheduledAt).toISOString()} · ${cb.status}`, scheduledAt: cb.scheduledAt, status: cb.status });
  for (const d of demos) events.push({ at: d.created, kind: 'demo', by: d.agentName, text: `Live demo booked for ${d.date} · ${d.status}`, status: d.status });
  for (const p of payments) events.push({ at: p.created, kind: 'payment', by: p.createdByName, text: `Payment link ₹${Number(p.amount || 0).toLocaleString('en-IN')} · ${p.status}${p.paidAt ? ' (paid)' : ''}`, status: p.status });
  for (const fa of finance) events.push({ at: fa.created, kind: 'finance', by: fa.createdByName, text: `Finance KYC form sent · ${fa.status}`, status: fa.status });
  for (const t of tickets) events.push({ at: t.created, kind: 'ticket', by: t.raisedByName, text: `Ticket: ${t.subject} · ${t.status}`, status: t.status });
  events.sort((a, b) => new Date(b.at) - new Date(a.at));

  if (!lead && !allCalls.length && !queue.length && !payments.length) return { notFound: true, phone: p10 };

  return {
    phone: p10,
    lead: lead
      ? {
          ...lead,
          id: String(lead._id),
          name: plain(lead.name),
          stageHistory: undefined,
          callHistory: undefined,
          ownerHistory: undefined,
        }
      : null,
    duplicates: leads.length > 1 ? leads.map((l) => ({ id: String(l._id), name: plain(l.name), stage: l.stage, owner: l.assignedUserName, created: l.created })) : [],
    name: plain((lead && lead.name) || (calls[0] && calls[0].contactName) || (legacy[0] && legacy[0].contactName)) || null,
    summary: {
      calls: allCalls.length,
      connected: connected.length,
      notPicked: allCalls.filter((c) => c.outcome === 'Not picked up').length,
      missed: allCalls.filter((c) => c.outcome === 'Missed by agent').length,
      talkSeconds: allCalls.reduce((a, c) => a + c.durationSec, 0),
      longest: Math.max(0, ...allCalls.map((c) => c.durationSec)),
      users: [...byUser.keys()].filter((k) => k !== 'Unassigned').length,
      firstContact: allCalls.length ? allCalls[allCalls.length - 1].at : null,
      lastContact: allCalls.length ? allCalls[0].at : null,
      stageMoves: leads.reduce((a, l) => a + (l.stageHistory || []).length, 0),
      paidAmount: payments.filter((p) => p.status === 'paid').reduce((a, p) => a + (p.amount || 0), 0),
    },
    byUser: [...byUser.values()].sort((a, b) => b.calls - a.calls),
    calls: allCalls,
    queue: queue.map((x) => ({ status: x.status, attempts: x.attempts || 0, lastDisposition: x.lastDisposition || null, source: x.source, lastAttemptAt: x.lastAttemptAt, created: x.created })),
    callbacks,
    demos,
    payments,
    finance,
    tickets,
    events: events.slice(0, 600),
  };
}

module.exports = { build, findCandidates };
