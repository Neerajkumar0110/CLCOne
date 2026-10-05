const mongoose = require('mongoose');
const { getOrCreateLeadPoolCampaign } = require('../../../../services/calling/callingShared');
const { NON_SALES_ROLES } = require('../../../../config/roles');
const shiftSchedule = require('../../../../config/shiftSchedule');
const { istDateKey, isWithinJoinWindow, activeBreakWindow } = require('../../../../services/calling/shiftHelpers');

// POST /api/calling/lead-pool/toggle { on: boolean }
// Joins/leaves the one system-managed Instant Lead Pool campaign — Sales
// agents only (mirrors campaigns.js's write-time guard). Joining adds the
// agent to the campaign's roster (so the existing auto-dialer tick, which
// only ever dials Available agents within camp.agents, naturally picks
// them up) and marks them Available on it; leaving marks them Offline.
const toggle = async (req, res) => {
  if (NON_SALES_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'The Instant Lead Pool is Sales-only.' });
  }
  const camp = await getOrCreateLeadPoolCampaign();
  const CallCampaign = mongoose.model('CallCampaign');
  const AgentCallState = mongoose.model('AgentCallState');

  const on = !!req.body.on;
  if (on) {
    await CallCampaign.updateOne({ _id: camp._id }, { $addToSet: { agents: req.admin._id } });
  }

  const now = new Date();
  const update = {
    $setOnInsert: { agent: req.admin._id },
    $set: {
      agentName: `${req.admin.name} ${req.admin.surname || ''}`.trim(),
      status: on ? 'Available' : 'Offline',
      campaign: on ? camp._id : null,
      since: now,
      lastSeenAt: now,
      // Leaving mid-call would otherwise leave a stale reference behind —
      // clear it so the next join starts clean.
      ...(on ? {} : { currentCall: null }),
    },
  };

  if (on) {
    // A genuine first join of the IST day resets the shift clock + today's
    // breaks; a brief re-toggle later the SAME day (e.g. a tab reload
    // double-firing, or manually stepping away and back) must NOT reset
    // worked-hours math or let today's breaks be taken again.
    const existing = await AgentCallState.findOne({ agent: req.admin._id }).select('shiftJoinedAt').lean();
    const joinedToday = existing && existing.shiftJoinedAt && istDateKey(existing.shiftJoinedAt) === istDateKey(now);
    if (!joinedToday) {
      update.$set.shiftJoinedAt = now;
      update.$set.breakMinutesToday = 0;
      update.$set.breaksTakenToday = [];
    }
  }

  await AgentCallState.updateOne({ agent: req.admin._id }, update, { upsert: true });

  return res.status(200).json({
    success: true,
    result: { on },
    message: on ? 'Joined the Instant Lead Pool' : 'Left the Instant Lead Pool',
  });
};

// GET /api/calling/lead-pool/status — my own join state + the shared pool's
// live numbers + my own recent calls (contact, duration, outcome) from it.
const status = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const CallLead = mongoose.model('CallLead');
  const CallRecord = mongoose.model('CallRecord');
  const AgentCallState = mongoose.model('AgentCallState');

  const camp = await CallCampaign.findOne({ isLeadPool: true, removed: false }).lean();
  if (!camp) {
    const now0 = new Date();
    return res.status(200).json({
      success: true,
      result: {
        on: false,
        myStatus: 'Offline',
        leadsWaiting: 0,
        participants: 0,
        poolExhausted: false,
        recentCalls: [],
        shift: {
          targetWorkMinutes: shiftSchedule.targetWorkMinutes,
          workedMinutesToday: 0,
          shouldAutoJoin: false,
          activeBreak: activeBreakWindow(now0) && { ...activeBreakWindow(now0), taken: false },
          onBreak: false,
          breakUntil: null,
          breakLabel: null,
        },
      },
      message: 'ok',
    });
  }

  const myState = await AgentCallState.findOne({ agent: req.admin._id }).lean();
  const on = !!(myState && myState.status !== 'Offline' && String(myState.campaign) === String(camp._id));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Shift/break info (spec: fixed daily schedule, see config/shiftSchedule.js)
  const now = new Date();
  const todayKey = istDateKey(now);
  const joinedToday = !!(myState && myState.shiftJoinedAt && istDateKey(myState.shiftJoinedAt) === todayKey);
  const breakMinutesToday = joinedToday ? myState.breakMinutesToday || 0 : 0;
  const breaksTakenToday = joinedToday ? myState.breaksTakenToday || [] : [];
  const workedMinutesToday =
    joinedToday && on ? Math.max(0, Math.round((now - new Date(myState.shiftJoinedAt)) / 60000) - breakMinutesToday) : 0;
  const win = activeBreakWindow(now);
  const activeBreak = win ? { key: win.key, label: win.label, durationMin: win.durationMin, taken: breaksTakenToday.includes(win.key) } : null;
  const shift = {
    targetWorkMinutes: shiftSchedule.targetWorkMinutes,
    workedMinutesToday,
    shouldAutoJoin: !on && isWithinJoinWindow(now) && !joinedToday,
    activeBreak,
    onBreak: !!(myState && myState.status === 'Paused' && myState.pausedUntil),
    breakUntil: myState && myState.status === 'Paused' ? myState.pausedUntil : null,
    breakLabel:
      myState && myState.status === 'Paused' && myState.breakKey
        ? (shiftSchedule.breaks.find((b) => b.key === myState.breakKey) || {}).label
        : null,
  };

  const [leadsWaiting, participants, recentCalls] = await Promise.all([
    CallLead.countDocuments({ campaign: camp._id, removed: false, status: { $in: ['New', 'Queued'] } }),
    AgentCallState.countDocuments({ campaign: camp._id, status: 'Available' }),
    CallRecord.find({ campaign: camp._id, agent: req.admin._id, removed: false, created: { $gte: todayStart } })
      .sort({ created: -1 })
      .limit(50)
      .select('contactName phone status disposition duration answeredAt endedAt')
      .lean(),
  ]);

  return res.status(200).json({
    success: true,
    result: {
      on,
      myStatus: myState ? myState.status : 'Offline',
      leadsWaiting,
      participants,
      poolExhausted: leadsWaiting === 0,
      shift,
      recentCalls: recentCalls.map((c) => ({
        _id: c._id,
        contactName: c.contactName,
        phone: c.phone,
        status: c.status,
        disposition: c.disposition,
        durationSec: c.duration || 0,
        answeredAt: c.answeredAt,
        endedAt: c.endedAt,
      })),
    },
    message: 'ok',
  });
};

// POST /api/calling/lead-pool/break/start { key } — the agent tapping a
// break offer (Tea/Lunch) shown in its scheduled window (config/
// shiftSchedule.js). Pauses the dialer for that break's fixed duration
// FROM THIS MOMENT (not until the window's nominal end) — see
// CloudCallProvider.tick() for the auto-resume-to-Available sweep once
// pausedUntil passes.
const breakStart = async (req, res) => {
  if (NON_SALES_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'The Instant Lead Pool is Sales-only.' });
  }
  const key = String((req.body && req.body.key) || '');
  const def = shiftSchedule.breaks.find((b) => b.key === key);
  if (!def) return res.status(400).json({ success: false, result: null, message: 'Unknown break.' });

  const AgentCallState = mongoose.model('AgentCallState');
  const state = await AgentCallState.findOne({ agent: req.admin._id });
  if (!state || state.status === 'Offline') {
    return res.status(409).json({ success: false, result: null, message: 'Join the Instant Lead Pool first.' });
  }
  if (state.status === 'Paused') {
    return res.status(409).json({ success: false, result: null, message: 'Already on a break.' });
  }

  const now = new Date();
  const win = activeBreakWindow(now);
  if (!win || win.key !== key) {
    return res.status(409).json({ success: false, result: null, message: `${def.label} isn't open right now.` });
  }
  const joinedToday = state.shiftJoinedAt && istDateKey(state.shiftJoinedAt) === istDateKey(now);
  if (joinedToday && (state.breaksTakenToday || []).includes(key)) {
    return res.status(409).json({ success: false, result: null, message: `You've already taken today's ${def.label}.` });
  }

  const pausedUntil = new Date(now.getTime() + def.durationMin * 60000);
  await AgentCallState.updateOne(
    { _id: state._id },
    {
      $set: { status: 'Paused', pausedUntil, breakKey: key, since: now },
      $addToSet: { breaksTakenToday: key },
      $inc: { breakMinutesToday: def.durationMin },
    }
  );

  return res.status(200).json({
    success: true,
    result: { pausedUntil, durationMin: def.durationMin, label: def.label },
    message: `${def.label} started — back at ${pausedUntil.toTimeString().slice(0, 5)}.`,
  });
};

// GET /api/calling/lead-pool/used-leads?page=&items= — every lead the pool
// has already attempted (pool-wide, every agent, not just me), with the
// response the system recorded for it. `status` is always populated by
// resolveLead the moment a call ends (Connected/No Answer/Busy/Voicemail/
// Completed/Callback/DNC), whether or not the agent picked an explicit
// disposition — so this list never shows a blank response.
const usedLeads = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const CallLead = mongoose.model('CallLead');

  const camp = await CallCampaign.findOne({ isLeadPool: true, removed: false }).select('_id').lean();
  if (!camp) {
    return res.status(200).json({ success: true, result: [], pagination: { page: 1, pages: 0, count: 0 }, message: 'ok' });
  }

  const page = parseInt(req.query.page) || 1;
  const items = Math.min(parseInt(req.query.items) || 30, 100);
  const filter = { campaign: camp._id, removed: false, status: { $nin: ['New', 'Queued'] } };

  const [rows, count] = await Promise.all([
    CallLead.find(filter)
      .sort({ updated: -1 })
      .skip((page - 1) * items)
      .limit(items)
      .lean(),
    CallLead.countDocuments(filter),
  ]);

  // CallLead (operationDb) and Admin (coreDb) live on different
  // connections under this app's multi-database routing, and Mongoose's
  // own .populate() can't cross that boundary — so resolve agent names
  // with a plain second lookup instead.
  const Admin = mongoose.model('Admin');
  const agentIds = [...new Set(rows.filter((l) => l.assignedAgent).map((l) => String(l.assignedAgent)))];
  const agents = agentIds.length
    ? await Admin.find({ _id: { $in: agentIds } }).select('name surname').lean()
    : [];
  const agentNameById = new Map(agents.map((a) => [String(a._id), `${a.name} ${a.surname || ''}`.trim()]));

  return res.status(200).json({
    success: true,
    result: rows.map((l) => ({
      _id: l._id,
      name: l.name,
      phone: l.phone,
      response: l.status,
      disposition: l.lastDisposition || null,
      agentName: l.assignedAgent ? agentNameById.get(String(l.assignedAgent)) || null : null,
      attempts: l.attempts,
      lastAttemptAt: l.lastAttemptAt,
    })),
    pagination: { page, pages: Math.ceil(count / items) || 0, count },
    message: 'ok',
  });
};

module.exports = { toggle, status, breakStart, usedLeads };
