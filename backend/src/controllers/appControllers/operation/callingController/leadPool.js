const mongoose = require('mongoose');
const {
  getOrCreateLeadPoolCampaign,
  callReachedCustomer,
  last10,
  CALL_REACHED,
  CALL_NOT_REACHED,
} = require('../../../../services/calling/callingShared');
const { NON_SALES_ROLES } = require('../../../../config/roles');
const shiftSchedule = require('../../../../config/shiftSchedule');
const { istDateKey, isWithinJoinWindow, activeBreakWindow } = require('../../../../services/calling/shiftHelpers');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');
const { STAGE_NAMES } = require('../../../../config/leadStages');
const { fillLeadPoolNow, stageQueueSummary, stagesOf, stageLeadFilter } = require('../../../../jobs/leadPoolSyncTick');
const MAX_POOL_STAGES = 5;
const connectModes = require('../../../../services/calling/connectModes');
const { fixMojibake } = require('../../../../utils/fixMojibake');
const { logActivity } = require('../../../../services/activity/agentActivity');
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
  await setPoolMembership(req.admin, on, req.admin);

  return res.status(200).json({
    success: true,
    result: { on },
    message: on ? 'Joined the Instant Lead Pool' : 'Left the Instant Lead Pool',
  });
};

// Joins/leaves `agent` (an Admin doc: _id, name, surname) — shared by the
// agent's own toggle above and management's per-user toggle in
// teamActivity.js. `by` = who did it, for the activity log.
async function setPoolMembership(agent, on, by = null) {
  const camp = await getOrCreateLeadPoolCampaign();
  const CallCampaign = mongoose.model('CallCampaign');
  const AgentCallState = mongoose.model('AgentCallState');
  const prev = await AgentCallState.findOne({ agent: agent._id }).select('status campaign').lean();
  const wasOn = !!(prev && prev.status !== 'Offline' && String(prev.campaign) === String(camp._id));

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
  if (wasOn !== on) {
    const self = by && String(by._id) === String(agent._id);
    logActivity(agent, on ? 'pool_on' : 'pool_off', { by, detail: by ? (self ? 'self' : 'by manager') : 'system' });
  }

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
  if (NON_SALES_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Calling is Sales-only.' });
  }
  const creds = await connectModes.ensureBrowserEndpoint(req.admin);
  return res.status(200).json({ success: true, result: creds, message: 'ok' });
};

// POST /api/calling/browser-phone/ready { ready } — the tab's heartbeat.
const browserReady = async (req, res) => {
  if (req.body && req.body.event) {
    console.log(`[browser-phone] ${req.admin.name} ${req.admin.surname || ''}: ${String(req.body.event).slice(0, 40)} ${String(req.body.detail || '').slice(0, 300)}`);
  }
  const AgentCallState = mongoose.model('AgentCallState');
  const goingOff = req.body && req.body.ready === false;
  const resetDone = req.body && req.body.event === 'reset-done';
  // A missed browser leg flagged this tab's phone as stuck (plivoAnswer.js
  // leg=agent-hangup): ignore its "ready" until it has rebuilt the phone.
  if (!goingOff && !resetDone) {
    const st = await AgentCallState.findOne({ agent: req.admin._id }).select('browserResetNeeded').lean();
    if (st && st.browserResetNeeded) {
      return res.status(200).json({ success: true, result: { reset: true }, message: 'reset' });
    }
  }
  // Upsert: a user who never joined the pool has no presence row yet, but
  // their Dialer / callback calls still ring the browser in this mode.
  await AgentCallState.updateOne(
    { agent: req.admin._id },
    {
      $setOnInsert: { agent: req.admin._id, agentName: `${req.admin.name} ${req.admin.surname || ''}`.trim(), status: 'Offline' },
      $set: { browserReadyAt: goingOff ? null : new Date(), ...(resetDone ? { browserResetNeeded: false } : {}) },
    },
    { upsert: true }
  );
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
  logActivity(req.admin, 'break_start', { by: req.admin, detail: `${def.label} · ${def.durationMin} min` });

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
  if (req.query.view === 'calls') return allCalls(req, res, page, items, camp ? camp._id : null);
  if (!camp) {
    return res.status(200).json({ success: true, result: [], pagination: { page: 1, pages: 0, count: 0 }, message: 'ok' });
  }

  // Filters (management view): ?response= CallLead.status, ?disposition=,
  // ?agent=<admin id>, ?stage=<pipeline stage the pool picked it from>,
  // ?from=&to= (YYYY-MM-DD, IST, on the last attempt), ?q= name / phone.
  const base = { campaign: camp._id, removed: false, status: { $nin: ['New', 'Queued'] } };
  const q = req.query;
  const and = [];
  if (q.stage) and.push({ source: q.stage === 'New Lead' ? 'CRM Lead Pool' : `CRM Lead Pool (${q.stage})` });
  // The agent who took a pool call is on its CallRecord (claimed when the
  // customer answered), not on the CallLead — filter through the records.
  const CallRecord = mongoose.model('CallRecord');
  if (q.agent && mongoose.isValidObjectId(q.agent)) {
    const ids = await CallRecord.distinct('callLead', { campaign: camp._id, agent: new mongoose.Types.ObjectId(q.agent) });
    and.push({ $or: [{ _id: { $in: ids } }, { assignedAgent: new mongoose.Types.ObjectId(q.agent) }] });
  }
  if (q.disposition) and.push({ lastDisposition: q.disposition === 'none' ? null : q.disposition });
  const day = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (day(q.from) || day(q.to)) {
    const at = {};
    if (day(q.from)) at.$gte = new Date(`${q.from}T00:00:00+05:30`);
    if (day(q.to)) at.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
    and.push({ lastAttemptAt: at });
  }
  if (q.q && String(q.q).trim()) {
    const rx = new RegExp(String(q.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    and.push({ $or: [{ name: rx }, { phone: rx }, { phoneNormalized: rx }] });
  }
  const scoped = and.length ? { ...base, $and: and } : base;
  const filter = q.response ? { ...scoped, status: q.response } : scoped;

  // Counts per response for the filter chips (everything but ?response=).
  const facetRows = await CallLead.aggregate([{ $match: scoped }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const facets = { total: 0, response: {} };
  for (const f of facetRows) {
    facets.response[f._id] = f.n;
    facets.total += f.n;
  }

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
  // Every agent / disposition the pool has ever recorded — for the filter
  // dropdowns, not just this page's rows.
  const [leadAgentIds, callAgentIds, allDispositions, rowCalls] = await Promise.all([
    CallLead.distinct('assignedAgent', base),
    CallRecord.distinct('agent', { campaign: camp._id }),
    CallLead.distinct('lastDisposition', base),
    // Latest call per row → who took it.
    CallRecord.find({ callLead: { $in: rows.map((l) => l._id) }, agent: { $ne: null } })
      .sort({ created: -1 })
      .select('callLead agent')
      .lean(),
  ]);
  const allAgentIds = [...new Set([...leadAgentIds, ...callAgentIds].filter(Boolean).map(String))];
  const Admin = mongoose.model('Admin');
  const agents = allAgentIds.length ? await Admin.find({ _id: { $in: allAgentIds } }).select('name surname').lean() : [];
  const agentNameById = new Map(agents.map((a) => [String(a._id), `${a.name} ${a.surname || ''}`.trim()]));
  const callAgentByLead = new Map();
  for (const c of rowCalls) if (!callAgentByLead.has(String(c.callLead))) callAgentByLead.set(String(c.callLead), String(c.agent));
  const stageOfSource = (s) => {
    if (s === 'CRM Lead Pool') return 'New Lead';
    const m = /^CRM Lead Pool \((.+)\)$/.exec(s || '');
    return m ? m[1] : s || null;
  };

  return res.status(200).json({
    success: true,
    result: rows.map((l) => ({
      _id: l._id,
      name: fixMojibake(l.name),
      phone: l.phone,
      response: l.status,
      disposition: l.lastDisposition || null,
      agentName: agentNameById.get(callAgentByLead.get(String(l._id)) || String(l.assignedAgent || '')) || null,
      stage: stageOfSource(l.source),
      attempts: l.attempts,
      lastAttemptAt: l.lastAttemptAt,
    })),
    pagination: { page, pages: Math.ceil(count / items) || 0, count },
    facets: {
      ...facets,
      agents: agents.map((a) => ({ id: String(a._id), name: agentNameById.get(String(a._id)) })).sort((a, b) => a.name.localeCompare(b.name)),
      dispositions: allDispositions.filter(Boolean).sort(),
    },
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
//   interested / demo / enrolled → the agent's response put the lead in
//              Interested Leads / Demo Booking / Enrolled (disposition), or
//              the lead on that number is in that stage right now
// Each row also carries the lead's current `stage` (looked up by phone).
// Same row shape as the pool-wide list, plus `outcome`.
const MY_USED_DAYS = [7, 15, 30];
const IN_PROGRESS = ['queued', 'dialing', 'ringing'];
const OUTCOME_LABEL = { connected: 'Connected', notpicked: 'Not picked up', missed: 'Missed by me' };
const STAGE_OUTCOMES = { interested: 'Interested Leads', demo: 'Demo Booking', enrolled: 'Enrolled' };
const phoneVariants = (p10) => [p10, `91${p10}`, `+91${p10}`, `0${p10}`];

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
  else if (STAGE_OUTCOMES[req.query.outcome]) {
    const stage = STAGE_OUTCOMES[req.query.outcome];
    const { BY_CODE } = require('../../../../services/calling/dispositions');
    const codes = Object.keys(BY_CODE).filter((c) => BY_CODE[c].crmStage && BY_CODE[c].crmStage.stage === stage);
    // Numbers I called in the range whose lead sits in that stage now.
    const phones = await CallRecord.distinct('phone', { agent: req.admin._id, removed: false, created: { $gte: since } });
    const p10 = [...new Set(phones.map((p) => last10(p)).filter((p) => p.length === 10))];
    const inStage = p10.length
      ? await mongoose.model('Lead').distinct('phoneNormalized', { removed: false, stage, phoneNormalized: { $in: p10 } })
      : [];
    and.push({ $or: [{ disposition: { $in: codes } }, { phone: { $in: inStage.flatMap(phoneVariants) } }] });
  }
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

  // Current pipeline stage of each row's lead (by phone).
  const rowP10 = [...new Set(rows.map((r) => last10(r.phone)).filter(Boolean))];
  const leadsByPhone = new Map(
    (rowP10.length
      ? await mongoose.model('Lead').find({ removed: false, phoneNormalized: { $in: rowP10 } }).select('phoneNormalized stage subStatus').lean()
      : []
    ).map((l) => [l.phoneNormalized, l])
  );

  return res.status(200).json({
    success: true,
    result: rows.map((r) => {
      const outcome = outcomeOf(r);
      const lead = leadsByPhone.get(last10(r.phone));
      return {
        _id: r._id,
        name: fixMojibake(r.contactName),
        phone: r.phone,
        stage: lead ? lead.stage : null,
        subStatus: lead ? lead.subStatus : null,
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

// Management's "All calls" view of Used Leads (?view=calls): every finished
// call by EVERY user — lead pool, Dialer, callbacks, Facebook instant leads,
// inbound — with the response the agent saved (disposition + notes) and the
// lead's current stage. Filters: ?agent= ?outcome= (same keys as My Calls)
// ?disposition= (or "none") ?type= pool|facebook|dialer|inbound ?q=
// ?from=&to= (YYYY-MM-DD IST) — or ?days= 7|15|30|90|0 (0 = all time).
const ALL_DAYS = [7, 15, 30, 90, 0];
async function allCalls(req, res, page, items, poolId) {
  const CallRecord = mongoose.model('CallRecord');
  const q = req.query;
  const day = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const base = { removed: false, status: { $nin: IN_PROGRESS } };
  if (day(q.from) || day(q.to)) {
    base.created = {};
    if (day(q.from)) base.created.$gte = new Date(`${q.from}T00:00:00+05:30`);
    if (day(q.to)) base.created.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
  } else {
    const days = ALL_DAYS.includes(Number(q.days)) ? Number(q.days) : 30;
    if (days) base.created = { $gte: new Date(Date.now() - days * 86400000) };
  }
  const and = [];
  if (q.agent && mongoose.isValidObjectId(q.agent)) base.agent = new mongoose.Types.ObjectId(q.agent);
  if (q.disposition) base.disposition = q.disposition === 'none' ? null : q.disposition;
  if (q.type === 'pool') base.campaign = poolId;
  else if (q.type === 'facebook') base.instantLead = true;
  else if (q.type === 'inbound') base.direction = 'Inbound';
  else if (q.type === 'dialer') and.push({ instantLead: { $ne: true }, direction: { $ne: 'Inbound' }, campaign: { $ne: poolId } });
  if (q.q && String(q.q).trim()) {
    const rx = new RegExp(String(q.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    and.push({ $or: [{ contactName: rx }, { phone: rx }, { notes: rx }] });
  }
  const scoped = and.length ? { ...base, $and: [...and] } : { ...base };

  // ?outcome= narrows further (the chips' counts ignore it).
  const filter = { ...scoped, $and: [...(scoped.$and || [])] };
  if (q.outcome === 'connected') filter.$and.push({ missedByAgent: { $ne: true } }, CALL_REACHED);
  else if (q.outcome === 'notpicked') filter.$and.push({ missedByAgent: { $ne: true } }, CALL_NOT_REACHED);
  else if (q.outcome === 'missed') filter.missedByAgent = true;
  else if (q.outcome === 'callback') filter.disposition = 'CALLBACK';
  else if (STAGE_OUTCOMES[q.outcome]) {
    const stage = STAGE_OUTCOMES[q.outcome];
    const { BY_CODE } = require('../../../../services/calling/dispositions');
    const codes = Object.keys(BY_CODE).filter((c) => BY_CODE[c].crmStage && BY_CODE[c].crmStage.stage === stage);
    filter.$and.push({ disposition: { $in: codes } });
  }
  if (!filter.$and.length) delete filter.$and;

  const and2 = (extra) => ({ ...scoped, $and: [...(scoped.$and || []), ...extra] });
  const [rows, count, nConnected, nNotPicked, nMissed, nAll, agentIds, dispositions] = await Promise.all([
    CallRecord.find(filter)
      .sort({ created: -1 })
      .skip((page - 1) * items)
      .limit(items)
      .select('contactName phone status disposition notes agent agentName duration missedByAgent created endedAt campaign instantLead direction')
      .lean(),
    CallRecord.countDocuments(filter),
    CallRecord.countDocuments(and2([{ missedByAgent: { $ne: true } }, CALL_REACHED])),
    CallRecord.countDocuments(and2([{ missedByAgent: { $ne: true } }, CALL_NOT_REACHED])),
    CallRecord.countDocuments({ ...scoped, missedByAgent: true }),
    CallRecord.countDocuments(scoped),
    CallRecord.distinct('agent', { removed: false }),
    CallRecord.distinct('disposition', { removed: false }),
  ]);

  const agents = agentIds.filter(Boolean).length
    ? await mongoose.model('Admin').find({ _id: { $in: agentIds.filter(Boolean) } }).select('name surname').lean()
    : [];
  const rowP10 = [...new Set(rows.map((r) => last10(r.phone)).filter(Boolean))];
  const leadsByPhone = new Map(
    (rowP10.length
      ? await mongoose.model('Lead').find({ removed: false, phoneNormalized: { $in: rowP10 } }).select('phoneNormalized stage subStatus').lean()
      : []
    ).map((l) => [l.phoneNormalized, l])
  );
  const typeOf = (r) =>
    r.instantLead ? 'Facebook lead' : r.direction === 'Inbound' ? 'Inbound' : poolId && String(r.campaign) === String(poolId) ? 'Lead pool' : 'Dialer';
  const ANY_LABEL = { connected: 'Connected', notpicked: 'Not picked up', missed: 'Missed by agent' };

  return res.status(200).json({
    success: true,
    result: rows.map((r) => {
      const outcome = outcomeOf(r);
      const lead = leadsByPhone.get(last10(r.phone));
      return {
        _id: r._id,
        name: fixMojibake(r.contactName),
        phone: r.phone,
        type: typeOf(r),
        stage: lead ? lead.stage : null,
        subStatus: lead ? lead.subStatus : null,
        outcome,
        response: ANY_LABEL[outcome],
        disposition: r.disposition || null,
        notes: r.notes ? String(r.notes).slice(0, 300) : null,
        durationSec: r.duration || 0,
        agentName: r.agentName || null,
        lastAttemptAt: r.endedAt || r.created,
      };
    }),
    pagination: { page, pages: Math.ceil(count / items) || 0, count },
    facets: {
      total: nAll,
      outcome: { connected: nConnected, notpicked: nNotPicked, missed: nMissed },
      agents: agents.map((a) => ({ id: String(a._id), name: `${a.name} ${a.surname || ''}`.trim() })).sort((a, b) => a.name.localeCompare(b.name)),
      dispositions: dispositions.filter(Boolean).sort(),
    },
    scope: 'all',
    message: 'ok',
  });
}

// GET /api/calling/my-calls/:id/detail — My Calls row click: the full lead
// behind one of MY calls (looked up by its number) + every call I made to
// that number. Keyed on my own CallRecord, so an agent sees the lead even
// when it isn't assigned to them (a pool lead), and nobody else's calls.
const myCallDetail = async (req, res) => {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success: false, result: null, message: 'Bad id' });
  const CallRecord = mongoose.model('CallRecord');
  const call = await CallRecord.findOne({ _id: id, removed: false }).lean();
  const mineOnly = !FULL_ACCESS_ROLES.includes(req.admin.role);
  if (!call || (mineOnly && String(call.agent) !== String(req.admin._id))) {
    return res.status(404).json({ success: false, result: null, message: 'Call not found' });
  }
  const p10 = last10(call.phone);
  const lead = p10
    ? await mongoose
        .model('Lead')
        .findOne({ removed: false, phoneNormalized: p10 })
        .select('-rawMetaData -rawGoogleData -rawLinkedInData')
        .lean()
    : null;
  const calls = p10
    ? await CallRecord.find({
        removed: false,
        phone: { $in: phoneVariants(p10) },
        ...(mineOnly ? { agent: req.admin._id } : {}),
      })
        .sort({ created: -1 })
        .limit(30)
        .select('status disposition duration missedByAgent agentLegAnswered agentName created endedAt notes recording.url recording.status')
        .lean()
    : [];
  return res.status(200).json({
    success: true,
    result: {
      lead,
      calls: calls.map((c) => ({
        _id: c._id,
        at: c.endedAt || c.created,
        outcome: OUTCOME_LABEL[outcomeOf(c)],
        disposition: c.disposition || null,
        durationSec: c.duration || 0,
        agentName: c.agentName || null,
        notes: c.notes || null,
        recordingUrl: c.recording && c.recording.status === 'available' ? c.recording.url : null,
      })),
    },
    message: 'ok',
  });
};

// GET /api/calling/lead-pool/stage-stats — for the "Dialing stages" picker:
// per pipeline stage, how many leads the pool could dial from it, and for
// the stages in the current order how far this round has got (dialed / still
// left / finished) and what came of the dialed ones. A "round" starts every
// time the order is saved (leadPoolStageSetAt).
const stageStats = async (req, res) => {
  if (!POOL_STAGE_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Not allowed.' });
  }
  const Lead = mongoose.model('Lead');
  const CallLead = mongoose.model('CallLead');
  const camp = await mongoose.model('CallCampaign').findOne({ isLeadPool: true, removed: false }).lean();
  if (!camp) return res.status(200).json({ success: true, result: { stages: [] }, message: 'ok' });

  const picked = stagesOf(camp);
  const active = camp.leadPoolStage || 'New Lead';
  const roundStart = camp.leadPoolStageSetAt || new Date(0);
  const pending = await CallLead.countDocuments({ campaign: camp._id, removed: false, status: { $in: ['New', 'Queued'] } });
  const tag = (s) => (s === 'New Lead' ? 'CRM Lead Pool' : `CRM Lead Pool (${s})`);

  const stages = [];
  for (const stage of STAGE_NAMES) {
    const dialable = { removed: false, stage, 'instantDispatch.status': { $nin: ['pending', 'calling'] } };
    if (stage === 'New Lead') dialable.$or = [{ assignedUser: null }, { assignedUser: { $exists: false } }];
    const row = { stage, available: await Lead.countDocuments(dialable), order: picked.indexOf(stage) + 1 || null };
    if (row.order) {
      const notQueued = await Lead.countDocuments(stageLeadFilter(camp, stage));
      const results = await CallLead.aggregate([
        { $match: { campaign: camp._id, removed: false, source: tag(stage), created: { $gte: new Date(roundStart) }, status: { $nin: ['New', 'Queued'] } } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]);
      row.left = notQueued + (stage === active ? pending : 0);
      row.dialed = results.reduce((a, r) => a + r.n, 0);
      row.results = Object.fromEntries(results.map((r) => [r._id, r.n]));
      row.active = stage === active;
      row.finished = row.left === 0;
    }
    stages.push(row);
  }
  return res.status(200).json({ success: true, result: { stages, roundStart: camp.leadPoolStageSetAt || null }, message: 'ok' });
};

module.exports = {
  stageStats,
  myCallDetail,
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
