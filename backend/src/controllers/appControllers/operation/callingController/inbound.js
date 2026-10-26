const mongoose = require('mongoose');
const { callingTier } = require('./permissions');
const { last10, LIVE_CALL_STATUSES } = require('../../../../services/calling/callingShared');
const inbound = require('../../../../services/calling/inboundRouting');
const { fixMojibake } = require('../../../../utils/fixMojibake');

// Calls page → "Incoming calls": customers who called our number, live and
// recent. Management sees every call; everyone else only the calls that
// rang them, were answered by them, or belong to their customers.
const IST = 'Asia/Kolkata';
const istDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: IST });
const istStart = (ymd) => new Date(`${ymd}T00:00:00+05:30`);
const fullName = (a) => (a ? fixMojibake(`${a.name || ''} ${a.surname || ''}`.trim()) : '');

function scopeFor(req) {
  if (callingTier(req) === 'admin') return {};
  const me = req.admin._id;
  return { $or: [{ agent: me }, { 'inbound.attempts.agent': me }, { 'inbound.stickyAgent': me }, { ownerAgent: me }] };
}

// Whose call a row is: who answered it; else the user it's filed under
// (CallRecord.ownerAgent, set at hangup), the lead's owner, the user who
// last spoke to this number, or the first user it rang — same order as
// callingShared.resolveCallOwner, computed here too so older calls show it.
function whoseCall(r, lead, lastSpoke) {
  if (r.agentLegAnswered && r.agentName) return { name: r.agentName, why: 'answered' };
  if (r.ownerAgentName) return { name: r.ownerAgentName, why: lead && lead.assignedUserName === r.ownerAgentName ? 'lead owner' : 'their customer' };
  if (lead && lead.assignedUserName) return { name: lead.assignedUserName, why: 'lead owner' };
  const spoke = lastSpoke.get(last10(r.phone));
  if (spoke) return { name: spoke, why: 'last spoke to them' };
  const first = r.inbound && (r.inbound.stickyAgentName || ((r.inbound.attempts || [])[0] || {}).agentName);
  if (first) return { name: first, why: 'rang first' };
  return null;
}

// What happened in the IVR menu (calls answered by an IvrFlow, not smart routing).
function ivrOutcome(r) {
  if (!r.ivrFlow) return null;
  const pressed = (r.ivrResponses || []).map((x) => `${x.digit}${x.label && x.label !== `Pressed ${x.digit}` ? ` (${x.label})` : ''}`);
  if (!pressed.length) return 'Hung up in the IVR menu — pressed nothing';
  if (r.agentLegAnswered) return `Pressed ${pressed.join(', ')}`;
  return `Pressed ${pressed.join(', ')} — nobody available`;
}

const rowOf = (r, leadsByPhone, cbByCall, lastSpoke) => {
  const lead = leadsByPhone.get(last10(r.phone));
  const cb = cbByCall.get(String(r._id));
  const live = LIVE_CALL_STATUSES.includes(r.status);
  const answered = !!r.agentLegAnswered;
  const talk = answered && r.answeredAt ? Math.max(0, Math.round((new Date(r.endedAt || Date.now()) - new Date(r.answeredAt)) / 1000)) : 0;
  return {
    _id: r._id,
    at: r.created,
    phone: r.phone,
    name: fixMojibake(r.contactName || '') || (lead && fixMojibake(lead.name)) || null,
    live,
    state: live ? (answered ? 'talking' : 'ringing') : answered ? 'answered' : 'missed',
    status: r.status,
    agent: r.agent,
    agentName: r.agentName || null,
    answeredBy: (r.inbound && r.inbound.answeredBy) || (answered ? r.agentName : null),
    answeredKind: r.inbound && r.inbound.answeredKind,
    ringing: r.inbound && r.inbound.ringing && r.inbound.ringing.agent ? r.inbound.ringing : null,
    attempts: (r.inbound && r.inbound.attempts) || [],
    sticky: r.inbound && r.inbound.stickyAgentName,
    forwardedBy: r.inbound && r.inbound.forwardedBy,
    waitSec: Math.max(0, Math.round((new Date(r.answeredAt || r.endedAt || Date.now()) - new Date(r.created)) / 1000)),
    talkSec: live ? talk : r.duration || talk,
    disposition: r.disposition || null,
    notes: r.notes && r.notes !== 'Inbound call' ? r.notes : null,
    recordingUrl: r.recording && r.recording.status === 'available' ? r.recording.url : null,
    callback: cb ? { status: cb.status, agentName: cb.assignedAgentName, scheduledAt: cb.scheduledAt } : null,
    lead: lead ? { id: lead._id, stage: lead.stage, subStatus: lead.subStatus, owner: lead.assignedUserName } : null,
    whose: whoseCall(r, lead, lastSpoke),
    ivr: ivrOutcome(r),
  };
};

// last10 → name of the user who last actually spoke to that number.
async function lastSpokeMap(phones) {
  if (!phones.length) return new Map();
  const { callReachedCustomer } = require('../../../../services/calling/callingShared');
  const prev = await mongoose
    .model('CallRecord')
    .find({ removed: false, agent: { $ne: null }, phone: new RegExp(`(${phones.join('|')})$`) })
    .select('phone agentName status duration answeredAt agentLegAnswered missedByAgent')
    .sort({ created: -1 })
    .limit(3000)
    .lean();
  const out = new Map();
  for (const c of prev) {
    const k = last10(c.phone);
    if (!out.has(k) && c.agentName && callReachedCustomer(c)) out.set(k, c.agentName);
  }
  return out;
}

// GET /calling/inbound?days=1|7|30 &state=missed|answered
const list = async (req, res) => {
  const CallRecord = mongoose.model('CallRecord');
  const days = [1, 7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 1;
  const today = istDay(new Date());
  const from = new Date(istStart(today).getTime() - (days - 1) * 86400000);
  const scope = scopeFor(req);

  const [liveRows, rows] = await Promise.all([
    CallRecord.find({ removed: false, direction: 'Inbound', status: { $in: LIVE_CALL_STATUSES }, created: { $gte: new Date(Date.now() - 30 * 60000) }, ...scope })
      .sort({ created: -1 })
      .lean(),
    CallRecord.find({ removed: false, direction: 'Inbound', status: { $nin: LIVE_CALL_STATUSES }, created: { $gte: from }, ...scope })
      .sort({ created: -1 })
      .limit(300)
      .lean(),
  ]);
  const all = [...liveRows, ...rows];
  const phones = [...new Set(all.map((r) => last10(r.phone)).filter(Boolean))];
  const [leads, cbs, lastSpoke] = await Promise.all([
    phones.length
      ? mongoose.model('Lead').find({ removed: false, phoneNormalized: { $in: phones } }).select('name phoneNormalized stage subStatus assignedUserName').lean()
      : [],
    mongoose.model('CallCallback').find({ removed: false, callRecord: { $in: all.map((r) => r._id) } }).select('callRecord status assignedAgentName scheduledAt').lean(),
    lastSpokeMap(phones.filter((p) => /^\d{10}$/.test(p))),
  ]);
  const leadsByPhone = new Map(leads.map((l) => [l.phoneNormalized, l]));
  const cbByCall = new Map(cbs.map((c) => [String(c.callRecord), c]));

  let recent = rows.map((r) => rowOf(r, leadsByPhone, cbByCall, lastSpoke));
  const summary = {
    total: recent.length,
    answered: recent.filter((r) => r.state === 'answered').length,
    missed: recent.filter((r) => r.state === 'missed').length,
    pendingCallbacks: recent.filter((r) => r.callback && r.callback.status === 'Pending').length,
    live: liveRows.length,
    // Missed calls per user they belong to ("No user" = nobody to file it under).
    missedByUser: Object.entries(
      recent.filter((r) => r.state === 'missed').reduce((acc, r) => {
        const k = (r.whose && r.whose.name) || 'No user';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {})
    )
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
  if (req.query.state === 'missed' || req.query.state === 'answered') recent = recent.filter((r) => r.state === req.query.state);

  // our number, for the "customers call" hint
  const callerId = require('../../../../config/calling').callingConfig.cloud.callerId || null;
  return res.status(200).json({
    success: true,
    result: { live: liveRows.map((r) => rowOf(r, leadsByPhone, cbByCall, lastSpoke)), recent, summary, days, number: callerId, isAdmin: callingTier(req) === 'admin' },
    message: 'ok',
  });
};

// GET /calling/inbound/forward-targets — who a live call can be passed to.
const forwardTargets = async (req, res) => {
  const { SALES_ROLE_ORDER } = require('../../../../config/roles');
  const roles = SALES_ROLE_ORDER || ['Sales Manager', 'Team Manager', 'Team Leader', 'Senior Executive', 'Executive', 'Sales Intern'];
  const admins = await mongoose
    .model('Admin')
    .find({ removed: false, enabled: { $ne: false }, role: { $in: roles }, _id: { $ne: req.admin._id } })
    .select('name surname role')
    .lean();
  const states = await mongoose.model('AgentCallState').find({ agent: { $in: admins.map((a) => a._id) } }).select('agent status campaign').lean();
  const stBy = new Map(states.map((s) => [String(s.agent), s]));
  const online = inbound.onlineIds();
  const out = [];
  for (const a of admins) {
    const st = stBy.get(String(a._id));
    const busy = st && ['Ringing', 'OnCall'].includes(st.status);
    const onBreak = st && st.status === 'Paused';
    out.push({
      id: a._id,
      name: fullName(a),
      role: a.role,
      online: online.has(String(a._id)),
      inPool: !!(st && st.campaign && st.status !== 'Offline'),
      state: busy ? 'busy' : onBreak ? 'break' : online.has(String(a._id)) || (st && st.status === 'Available') ? 'free' : 'offline',
    });
  }
  const rank = { free: 0, offline: 1, break: 2, busy: 3 };
  out.sort((x, y) => rank[x.state] - rank[y.state] || roles.indexOf(x.role) - roles.indexOf(y.role) || x.name.localeCompare(y.name));
  return res.status(200).json({ success: true, result: out, message: 'ok' });
};

// POST /calling/inbound/:id/forward { toAgent }
const forward = async (req, res) => {
  const rec = mongoose.isValidObjectId(req.params.id) ? await mongoose.model('CallRecord').findOne({ _id: req.params.id, removed: false }) : null;
  if (!rec || rec.direction !== 'Inbound' || !rec.inbound || rec.inbound.routedBy !== 'smart') {
    return res.status(404).json({ success: false, result: null, message: 'Incoming call not found.' });
  }
  if (callingTier(req) !== 'admin' && String(rec.agent) !== String(req.admin._id)) {
    return res.status(403).json({ success: false, result: null, message: 'Only the person on this call can forward it.' });
  }
  if (!req.body.toAgent || !mongoose.isValidObjectId(req.body.toAgent)) {
    return res.status(400).json({ success: false, result: null, message: 'Pick who to forward it to.' });
  }
  const r = await inbound.forward(rec, req.admin, req.body.toAgent);
  return res.status(r.ok ? 200 : 400).json({
    success: r.ok,
    result: null,
    message: r.ok ? `Ringing ${r.name} — you'll be dropped as soon as they pick up.` : r.error,
  });
};

module.exports = { list, forwardTargets, forward };
