const mongoose = require('mongoose');
const {
  getOrCreateLeadPoolCampaign,
  callReachedCustomer,
  CALL_REACHED,
  CALL_NOT_REACHED,
} = require('../../../../services/calling/callingShared');
const { NON_SALES_ROLES } = require('../../../../config/roles');
const shiftSchedule = require('../../../../config/shiftSchedule');
const { istDateKey, isWithinJoinWindow, activeBreakWindow } = require('../../../../services/calling/shiftHelpers');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');
const { STAGE_NAMES } = require('../../../../config/leadStages');
const { fillLeadPoolNow, stageQueueSummary, stagesOf } = require('../../../../jobs/leadPoolSyncTick');
const MAX_POOL_STAGES = 5;
const connectModes = require('../../../../services/calling/connectModes');
const { CRM_ADMIN_ROLES } = require('../../../../config/roles');

// Who may point the Instant Lead Pool at a different Sales stage: full
// access (owner/Super Admin/Admin/Sales Manager/Team Manager) + Team Leader.
const POOL_STAGE_ROLES = [...FULL_ACCESS_ROLES, 'Team Leader'];

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
  const on = !!req.body.on;
  await setPoolMembership(req.admin, on);

  return res.status(200).json({
    success: true,
    result: { on },
    message: on ? 'Joined the Instant Lead Pool' : 'Left the Instant Lead Pool',
  });
};

// Joins/leaves `agent` (an Admin doc: _id, name, surname) — shared by the
// agent's own toggle above and management's per-user toggle in
// teamActivity.js.
async function setPoolMembership(agent, on) {
  const camp = await getOrCreateLeadPoolCampaign();
  const CallCampaign = mongoose.model('CallCampaign');
  const AgentCallState = mongoose.model('AgentCallState');

  if (on) {
    await CallCampaign.updateOne({ _id: camp._id }, { $addToSet: { agents: agent._id } });
  }

  const now = new Date();
  const update = {
    $setOnInsert: { agent: agent._id },
    $set: {
      agentName: `${agent.name} ${agent.surname || ''}`.trim(),
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
    const existing = await AgentCallState.findOne({ agent: agent._id }).select('shiftJoinedAt').lean();
    const joinedToday = existing && existing.shiftJoinedAt && istDateKey(existing.shiftJoinedAt) === istDateKey(now);
    if (!joinedToday) {
      update.$set.shiftJoinedAt = now;
      update.$set.breakMinutesToday = 0;
      update.$set.breaksTakenToday = [];
    }
  }

  await AgentCallState.updateOne({ agent: agent._id }, update, { upsert: true });

  // alwaysOn: joining calls the agent's mobile once (their standing line);
  // leaving hangs it up. Other modes: nothing to do here.
  if ((await connectModes.getConnectMode({ fresh: true })) === 'alwaysOn') {
    if (on) {
      const full = await mongoose.model('Admin').findById(agent._id).select('name surname phone mobile contactNumber').lean();
      if (full) await connectModes.startAgentLine(full).catch((e) => console.error('[pool] agent line:', e.message));
    } else {
      await connectModes.stopAgentLine(agent._id).catch(() => {});
    }
  } else if (!on) {
    await connectModes.stopAgentLine(agent._id).catch(() => {});
  }
}

// POST /api/calling/lead-pool/connect-mode { mode } — Admin / Super Admin
// only. Switching INTO alwaysOn calls every agent already in the pool;
// switching OUT of it hangs their standing lines up.
const setConnectMode = async (req, res) => {
  if (!CRM_ADMIN_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Only Admin / Super Admin can change how calls connect.' });
  }
  const mode = String((req.body && req.body.mode) || '');
  if (!connectModes.MODES.includes(mode)) {
    return res.status(400).json({ success: false, result: null, message: 'Unknown mode.' });
  }
  const camp = await getOrCreateLeadPoolCampaign();
  const prev = camp.leadPoolConnectMode || 'classic';
  await mongoose.model('CallCampaign').updateOne(
    { _id: camp._id },
    { $set: { leadPoolConnectMode: mode, leadPoolConnectModeSetByName: `${req.admin.name} ${req.admin.surname || ''}`.trim() } }
  );
  connectModes.clearModeCache();

  const inPool = await mongoose
    .model('AgentCallState')
    .find({ campaign: camp._id, status: { $ne: 'Offline' } })
    .select('agent')
    .lean();
  if (prev === 'alwaysOn' && mode !== 'alwaysOn') {
    for (const st of inPool) await connectModes.stopAgentLine(st.agent).catch(() => {});
  }
  let called = 0;
  if (mode === 'alwaysOn' && prev !== 'alwaysOn') {
    const admins = await mongoose
      .model('Admin')
      .find({ _id: { $in: inPool.map((x) => x.agent) } })
      .select('name surname phone mobile contactNumber')
      .lean();
    for (const a of admins) {
      const r = await connectModes.startAgentLine(a).catch(() => ({ ok: false }));
      if (r.ok) called += 1;
    }
  }
  const label = { classic: 'Ring the mobile for each call', alwaysOn: 'Always-on agent line', browser: 'Browser phone' }[mode];
  return res.status(200).json({
    success: true,
    result: { mode },
    message: mode === 'alwaysOn' && called ? `${label} — calling ${called} agent(s) in the pool now.` : `Calls now connect by: ${label}.`,
  });
};

// POST /api/calling/lead-pool/line/connect — alwaysOn: (re)call my own line.
const lineConnect = async (req, res) => {
  const full = await mongoose.model('Admin').findById(req.admin._id).select('name surname phone mobile contactNumber').lean();
  const st = await mongoose.model('AgentCallState').findOne({ agent: req.admin._id }).select('campaign status').lean();
  if (!st || !st.campaign || st.status === 'Offline') {
    return res.status(400).json({ success: false, result: null, message: 'Join the pool first.' });
  }
  const r = await connectModes.startAgentLine(full);
  return res.status(r.ok ? 200 : 400).json({
    success: r.ok,
    result: null,
    message: r.ok ? 'Calling your phone — pick up and stay on the line.' : r.error,
  });
};

// GET /api/calling/browser-phone/credentials — browser mode: my SIP login.
const browserCredentials = async (req, res) => {
  if ((await connectModes.getConnectMode()) !== 'browser') {
    return res.status(400).json({ success: false, result: null, message: 'Browser phone is not switched on.' });
  }
  const creds = await connectModes.ensureBrowserEndpoint(req.admin);
  return res.status(200).json({ success: true, result: creds, message: 'ok' });
};

// POST /api/calling/browser-phone/ready { ready } — the tab's heartbeat.
const browserReady = async (req, res) => {
  await mongoose
    .model('AgentCallState')
    .updateOne({ agent: req.admin._id }, { $set: { browserReadyAt: req.body && req.body.ready === false ? null : new Date() } });
  return res.status(200).json({ success: true, result: null, message: 'ok' });
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
        stage: 'New Lead',
        stages: ['New Lead'],
        stageQueue: [],
        maxStages: MAX_POOL_STAGES,
        stageOptions: STAGE_NAMES,
        canSetStage: POOL_STAGE_ROLES.includes(req.admin.role),
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
      stage: camp.leadPoolStage || 'New Lead',
      stages: stagesOf(camp),
      stageQueue: await stageQueueSummary(camp).catch(() => []),
      maxStages: MAX_POOL_STAGES,
      stageSetByName: camp.leadPoolStageSetByName || null,
      connectMode: camp.leadPoolConnectMode || 'classic',
      connectModeSetByName: camp.leadPoolConnectModeSetByName || null,
      canSetConnectMode: CRM_ADMIN_ROLES.includes(req.admin.role),
      myLineLive: !!(myState && myState.agentLineLive),
      myBrowserReady: !!(myState && myState.browserReadyAt && Date.now() - new Date(myState.browserReadyAt).getTime() < 75000),
      stageOptions: STAGE_NAMES,
      canSetStage: POOL_STAGE_ROLES.includes(req.admin.role),
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

// POST /api/calling/lead-pool/stage { stage } — management points the whole
// pool at one Sales pipeline stage. Leads still waiting from the previous
// pick are dropped from the queue (their CRM Lead is untouched), and
// leadPoolSyncTick starts queuing the new stage on its next tick — including
// leads the pool already dialed under an earlier pick (leadPoolStageSetAt).
const setStage = async (req, res) => {
  if (!POOL_STAGE_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Only management can change the dialing stage.' });
  }
  // { stages: [...] } in priority order (1-5), or the older { stage }.
  const body = req.body || {};
  const raw = Array.isArray(body.stages) ? body.stages : [body.stage];
  const stages = [...new Set(raw.map((s) => String(s || '')).filter(Boolean))];
  if (!stages.length || stages.some((s) => !STAGE_NAMES.includes(s))) {
    return res.status(400).json({ success: false, result: null, message: 'Unknown stage.' });
  }
  if (stages.length > MAX_POOL_STAGES) {
    return res.status(400).json({ success: false, result: null, message: `Pick at most ${MAX_POOL_STAGES} stages.` });
  }
  const stage = stages[0];

  const camp = await getOrCreateLeadPoolCampaign();
  const CallCampaign = mongoose.model('CallCampaign');
  const CallLead = mongoose.model('CallLead');

  await CallLead.updateMany(
    { campaign: camp._id, removed: false, status: { $in: ['New', 'Queued'] } },
    { $set: { removed: true, updated: new Date() } }
  );
  await CallCampaign.updateOne(
    { _id: camp._id },
    {
      $set: {
        leadPoolStage: stage,
        leadPoolStages: stages,
        leadPoolStageActiveAt: new Date(),
        leadPoolStageSetAt: new Date(),
        leadPoolStageSetByName: `${req.admin.name} ${req.admin.surname || ''}`.trim(),
        leadsExhaustedNotifiedAt: null,
      },
    }
  );

  // Fill the queue right away rather than waiting for the next 30s tick.
  const queued = await fillLeadPoolNow().catch((e) => {
    console.error('lead pool immediate fill failed:', e && e.message);
    return 0;
  });

  return res.status(200).json({
    success: true,
    result: { stage, stages, queued },
    message: queued
      ? `Instant Lead Pool now dials ${stages.join(' → ')} — ${queued} lead(s) queued.`
      : `Instant Lead Pool now dials ${stages.join(' → ')} — no leads to dial in these stages right now.`,
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

  const page = parseInt(req.query.page) || 1;
  const items = Math.min(parseInt(req.query.items) || 30, 100);

  // Pool-wide list is management-only (FULL_ACCESS_ROLES). Everyone else
  // gets every call of their own (pool, dialer, callbacks — see
  // myUsedLeads below), pool or no pool.
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) return myUsedLeads(req, res, page, items);

  const camp = await CallCampaign.findOne({ isLeadPool: true, removed: false }).select('_id').lean();
  if (!camp) {
    return res.status(200).json({ success: true, result: [], pagination: { page: 1, pages: 0, count: 0 }, message: 'ok' });
  }

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

// The agent's own view of Used Leads: EVERY call of theirs that has
// finished — auto-dialer pool, manual dialer, callbacks, any campaign — in
// the last ?days= (7 | 15 | 30, default 7), narrowed by ?outcome=:
//   connected → the customer answered
//   notpicked → they dialed, the customer never answered
//   missed    → routed to them, they never picked up (CallRecord.missedByAgent)
//   callback  → a callback was requested on it (disposition CALLBACK)
// Same row shape as the pool-wide list, plus `outcome`.
const MY_USED_DAYS = [7, 15, 30];
const IN_PROGRESS = ['queued', 'dialing', 'ringing'];
const OUTCOME_LABEL = { connected: 'Connected', notpicked: 'Not picked up', missed: 'Missed by me' };

function outcomeOf(r) {
  if (r.missedByAgent) return 'missed';
  if (callReachedCustomer(r)) return 'connected';
  return 'notpicked';
}

async function myUsedLeads(req, res, page, items) {
  const CallRecord = mongoose.model('CallRecord');
  const days = MY_USED_DAYS.includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const since = new Date(Date.now() - days * 86400000);

  const filter = { agent: req.admin._id, removed: false, created: { $gte: since }, status: { $nin: IN_PROGRESS } };
  const and = [];
  if (req.query.outcome === 'connected') and.push({ missedByAgent: { $ne: true } }, CALL_REACHED);
  else if (req.query.outcome === 'notpicked') and.push({ missedByAgent: { $ne: true } }, CALL_NOT_REACHED);
  else if (req.query.outcome === 'missed') filter.missedByAgent = true;
  else if (req.query.outcome === 'callback') filter.disposition = 'CALLBACK';
  if (and.length) filter.$and = and;

  const [rows, count] = await Promise.all([
    CallRecord.find(filter)
      .sort({ created: -1 })
      .skip((page - 1) * items)
      .limit(items)
      .select('contactName phone status disposition agentName duration missedByAgent created endedAt')
      .lean(),
    CallRecord.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    result: rows.map((r) => {
      const outcome = outcomeOf(r);
      return {
        _id: r._id,
        name: r.contactName,
        phone: r.phone,
        outcome,
        response: OUTCOME_LABEL[outcome],
        disposition: r.disposition || null,
        agentName: r.agentName || null,
        lastAttemptAt: r.endedAt || r.created,
      };
    }),
    pagination: { page, pages: Math.ceil(count / items) || 0, count },
    scope: 'mine',
    message: 'ok',
  });
}

module.exports = {
  toggle,
  status,
  setStage,
  breakStart,
  usedLeads,
  setPoolMembership,
  setConnectMode,
  lineConnect,
  browserCredentials,
  browserReady,
};
