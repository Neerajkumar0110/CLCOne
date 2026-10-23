const mongoose = require('mongoose');
const { callingConfig } = require('../../config/calling');
const { last10, agentsOnLiveCalls, notifyAgentCallEvent, callReachedCustomer } = require('./callingShared');
const { fixMojibake } = require('../../utils/fixMojibake');

// Inbound smart routing — a customer calling our number.
//
//   1. The user this customer last actually spoke to (else the lead's owner)
//      if they're free and on the CRM / in the pool.
//   2. Otherwise a free Instant Lead Pool user (longest idle first) — at most
//      two of them, one after the other.
//   3. Otherwise a Team Leader (the sticky user's own, else any online one).
//   4. Nobody picked up → "we'll call you back", and a callback lands with
//      the sticky user (or the leader) so the auto-dialer returns the call.
//
// One phone rings at a time. The customer hears a short welcome and a hold
// loop (plivoAnswer leg=inbound-hold) while we ring; the instant someone
// answers, the customer's call is redirected into the conference. Whoever
// is on the call can forward it — the target's phone rings, and when they
// answer the forwarder's leg is dropped (customer is never left alone).

const RING_SEC = Number(process.env.INBOUND_RING_TIMEOUT_SEC || 20);
const MAX_FREE = 2;
const MAX_LEADERS = 2;
const MAX_HOLD_LOOPS = 14; // ~9s each → about two minutes on hold, then callback
const LEADER_ROLES = ['Team Leader', 'Team Manager', 'Sales Manager'];
const BUSY = ['Ringing', 'OnCall', 'Paused'];
const BROWSER_READY_MS = 75 * 1000;

const cfg = () => callingConfig.cloud;
const pv = () => callingConfig.cloud.plivo;
const secretQs = () => (cfg().webhookSecret ? `&secret=${encodeURIComponent(cfg().webhookSecret)}` : '');
const answerUrl = (q) => `${pv().publicBaseUrl}/api/cloud-call/plivo-answer?${q}${secretQs()}`;
const authHeaders = () => ({
  Authorization: `Basic ${Buffer.from(`${pv().authId}:${pv().authToken}`).toString('base64')}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});
const fullName = (a) => (a ? fixMojibake(`${a.name || ''} ${a.surname || ''}`.trim()) : '');
const Rec = () => mongoose.model('CallRecord');
const State = () => mongoose.model('AgentCallState');
const Admin = () => mongoose.model('Admin');

function onlineIds() {
  try {
    return new Set(require('../../socket').getOnlineUserIds().map(String));
  } catch {
    return new Set();
  }
}

// ── who could take it ────────────────────────────────────────────────────
async function lastSpokeTo(p10) {
  const tail = new RegExp(`${p10}$`);
  const rows = await Rec()
    .find({ removed: false, phone: tail, agent: { $ne: null }, agentLegAnswered: true })
    .select('agent agentName status duration answeredAt agentLegAnswered missedByAgent direction')
    .sort({ created: -1 })
    .limit(15)
    .lean();
  const hit = rows.find((r) => callReachedCustomer(r));
  return hit ? { id: hit.agent, name: hit.agentName } : null;
}

async function leaderOf(agentId) {
  let cur = await Admin().findById(agentId).select('reportsTo').lean();
  for (let i = 0; cur && cur.reportsTo && i < 6; i += 1) {
    const up = await Admin().findById(cur.reportsTo).select('name surname role reportsTo removed enabled').lean();
    if (!up) return null;
    if (LEADER_ROLES.includes(up.role) && !up.removed && up.enabled !== false) return up;
    cur = up;
  }
  return null;
}

// Free = enabled, has somewhere to ring, not ringing / talking / on a break,
// and (unless `anyPresence`) either online in the CRM or in the pool.
async function usable(adminId, { online, needPresence = true } = {}) {
  const a = await Admin()
    .findById(adminId)
    .select('name surname phone mobile contactNumber role removed enabled')
    .lean();
  if (!a || a.removed || a.enabled === false) return null;
  const st = await State().findOne({ agent: adminId }).lean();
  if (st && BUSY.includes(st.status)) return null;
  if ((await agentsOnLiveCalls([adminId])).size) return null;
  if (needPresence && !(online.has(String(adminId)) || (st && st.status === 'Available'))) return null;
  const device = await deviceFor(a, st);
  return device ? { admin: a, state: st, device } : null;
}

// Where their phone is: browser tab (browser mode, registered), their
// always-on line (alwaysOn mode, live), else the mobile number.
async function deviceFor(admin, st) {
  const mode = await require('./connectModes').getConnectMode();
  if (mode === 'browser' && st && st.plivoEndpoint && st.plivoEndpoint.username && !st.browserResetNeeded &&
      st.browserReadyAt && Date.now() - new Date(st.browserReadyAt).getTime() < BROWSER_READY_MS) {
    return { kind: 'browser', to: `sip:${st.plivoEndpoint.username}@phone.plivo.com` };
  }
  if (mode === 'alwaysOn' && st && st.agentLineLive) return { kind: 'line' };
  const n = last10(admin.phone || admin.mobile || admin.contactNumber);
  return n ? { kind: 'mobile', to: `${pv().countryCode}${n}` } : null;
}

// Mark them Ringing for this call — atomic, so the pool can't hand them a
// customer in the same second. Returns their previous status, or null if
// someone else grabbed them first.
async function claim(adminId, name, recId) {
  await State().updateOne({ agent: adminId }, { $setOnInsert: { agent: adminId, agentName: name, status: 'Offline' } }, { upsert: true });
  const prev = await State().findOneAndUpdate(
    { agent: adminId, status: { $nin: BUSY } },
    { $set: { status: 'Ringing', currentCall: recId, since: new Date(), lastSeenAt: new Date() } },
    { new: false }
  ).lean();
  return prev ? prev.status || 'Offline' : null;
}

// Give them back exactly how we found them (pool users → Available).
async function release(adminId, recId, prevStatus) {
  if (!adminId) return;
  const back = ['Available', 'Wrapup'].includes(prevStatus) ? 'Available' : prevStatus || 'Offline';
  await State().updateOne(
    { agent: adminId, status: 'Ringing', currentCall: recId },
    { $set: { status: back, currentCall: null, since: new Date(), lastSeenAt: new Date() } }
  );
}

// Next person to ring, in order, skipping everyone already tried.
async function pickNext(rec) {
  const tried = new Set((rec.inbound.attempts || []).map((x) => String(x.agent)));
  const online = onlineIds();
  const kinds = (k) => (rec.inbound.attempts || []).filter((x) => x.kind === k).length;

  // 1. who they spoke to before / the lead's owner
  for (const [id, kind] of [[rec.inbound.stickyAgent, 'previous'], [rec._ownerId, 'owner']]) {
    if (!id || tried.has(String(id))) continue;
    const u = await usable(id, { online });
    if (u) return { ...u, kind };
  }

  // 2. a free pool user, longest idle first
  if (kinds('free') < MAX_FREE) {
    const states = await State()
      .find({ status: 'Available', campaign: { $ne: null }, agent: { $nin: [...tried].map((x) => new mongoose.Types.ObjectId(x)) } })
      .sort({ since: 1 })
      .limit(10)
      .select('agent')
      .lean();
    for (const s of states) {
      const u = await usable(s.agent, { online });
      if (u) return { ...u, kind: 'free' };
    }
  }

  // 3. a Team Leader — the sticky user's own first, then anyone online
  if (kinds('leader') < MAX_LEADERS) {
    const own = rec.inbound.stickyAgent ? await leaderOf(rec.inbound.stickyAgent) : rec._ownerId ? await leaderOf(rec._ownerId) : null;
    const ids = own ? [own._id] : [];
    for (const role of LEADER_ROLES) {
      const more = await Admin().find({ role, removed: false, enabled: { $ne: false } }).select('_id').lean();
      ids.push(...more.map((m) => m._id).filter((x) => online.has(String(x))));
    }
    for (const id of ids) {
      if (tried.has(String(id))) continue;
      const u = await usable(id, { online });
      if (u) return { ...u, kind: 'leader' };
    }
  }
  return null;
}

// ── telephony ────────────────────────────────────────────────────────────
async function placeLeg(rec, agentId, to) {
  const res = await fetch(`${pv().apiBase}/v1/Account/${pv().authId}/Call/`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      from: rec.callerId || cfg().callerId,
      to,
      caller_name: (rec.contactName || '').slice(0, 50) || undefined,
      answer_url: answerUrl(`crmCallId=${rec._id}&leg=agent&agentId=${agentId}`),
      answer_method: 'POST',
      ring_timeout: RING_SEC,
      hangup_url: answerUrl(`crmCallId=${rec._id}&leg=agent-hangup&agentId=${agentId}`),
      hangup_method: 'POST',
    }),
  });
  if (!res.ok) throw new Error(`Plivo leg failed (HTTP ${res.status}): ${await res.text().catch(() => '')}`);
  const json = await res.json().catch(() => null);
  return json && (Array.isArray(json.request_uuid) ? json.request_uuid[0] : json.request_uuid);
}

async function redirectCustomer(rec, url) {
  if (!rec.providerCallId) return;
  await fetch(`${pv().apiBase}/v1/Account/${pv().authId}/Call/${rec.providerCallId}/`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ legs: 'aleg', aleg_url: url, aleg_method: 'POST' }),
  }).catch((e) => console.error('[inbound] redirect failed:', e.message));
}

async function hangupCall(uuid) {
  if (!uuid) return;
  await fetch(`${pv().apiBase}/v1/Account/${pv().authId}/Call/${uuid}/`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
}
async function cancelRequest(requestId) {
  if (!requestId) return;
  await fetch(`${pv().apiBase}/v1/Account/${pv().authId}/Request/${requestId}/`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
}

const isLive = (rec) => rec && ['dialing', 'ringing', 'connected', 'onhold'].includes(rec.status);

// ── lifecycle ────────────────────────────────────────────────────────────

// A new inbound call reached plivo-answer: open the record, find who they
// spoke to before, and start ringing.
async function start({ from, to, callUuid }) {
  const p10 = last10(from);
  const lead = p10
    ? await mongoose.model('Lead').findOne({ phoneNormalized: p10, removed: false }).select('name assignedUser assignedUserName').sort({ updated: -1 }).lean()
    : null;
  const sticky = p10 ? await lastSpokeTo(p10) : null;
  const now = new Date();
  const rec = await new (Rec())({
    direction: 'Inbound',
    status: 'ringing',
    phaseAt: now,
    queuedAt: now,
    ringingAt: now,
    phone: String(from || '').trim(),
    contactName: (lead && fixMojibake(lead.name)) || 'Inbound caller',
    provider: 'cloud',
    providerCallId: callUuid || undefined,
    isMock: false,
    callerId: to ? String(to) : undefined,
    notes: 'Inbound call',
    inbound: {
      routedBy: 'smart',
      stickyAgent: sticky ? sticky.id : undefined,
      stickyAgentName: sticky ? sticky.name : undefined,
      holdSince: now,
      attempts: [],
    },
  }).save();
  broadcast(rec);
  return rec;
}

// Ring the next person. Guarded so two triggers (a missed leg + the hold
// loop's safety net) can't ring two phones at once.
async function ringNext(recId) {
  const lock = await Rec().findOneAndUpdate(
    {
      _id: recId,
      status: { $in: ['dialing', 'ringing'] },
      agentLegAnswered: { $ne: true },
      'inbound.exhausted': { $ne: true },
      $or: [{ 'inbound.ringing.kind': null }, { 'inbound.ringing.at': { $lte: new Date(Date.now() - (RING_SEC + 15) * 1000) } }],
    },
    { $set: { 'inbound.ringing': { kind: 'picking', at: new Date() } } },
    { new: true }
  );
  if (!lock) return false;
  if (lock.inbound.ringing && lock.inbound.ringing.agent) {
    // a leg that never reported back — let its agent go before moving on
    await release(lock.inbound.ringing.agent, lock._id, lock.inbound.ringing.prevStatus);
  }
  const p10 = last10(lock.phone);
  const lead = p10 ? await mongoose.model('Lead').findOne({ phoneNormalized: p10, removed: false }).select('assignedUser').sort({ updated: -1 }).lean() : null;
  lock._ownerId = lead && lead.assignedUser;

  for (let guard = 0; guard < 6; guard += 1) {
    const next = await pickNext(lock);
    if (!next) break;
    const name = fullName(next.admin);
    const prevStatus = await claim(next.admin._id, name, lock._id);
    if (prevStatus === null) {
      lock.inbound.attempts.push({ agent: next.admin._id, agentName: name, kind: next.kind, device: next.device.kind, at: new Date(), result: 'busy' });
      continue;
    }
    const attempt = { agent: next.admin._id, agentName: name, kind: next.kind, device: next.device.kind, at: new Date(), result: 'ringing' };

    // alwaysOn: their line is already open — the customer just walks in.
    if (next.device.kind === 'line') {
      attempt.result = 'answered';
      lock.inbound.attempts.push(attempt);
      lock.inbound.ringing = { kind: null };
      await lock.save();
      await answered(lock, next.admin._id, null, { kind: next.kind, prevStatus, line: true });
      return true;
    }

    try {
      const reqId = await placeLeg(lock, next.admin._id, next.device.to);
      lock.agentLegRequestId = reqId ? String(reqId) : undefined;
      lock.inbound.attempts.push(attempt);
      lock.inbound.ringing = { agent: next.admin._id, agentName: name, kind: next.kind, prevStatus, at: new Date() };
      lock.phaseAt = new Date();
      await lock.save();
      notifyAgentCallEvent(next.admin._id, 'call:incoming', { ...lock.toObject(), ringingKind: next.kind }).catch(() => {});
      broadcast(lock);
      return true;
    } catch (err) {
      console.error('[inbound] ring failed:', err.message);
      await release(next.admin._id, lock._id, prevStatus);
      attempt.result = 'failed';
      lock.inbound.attempts.push(attempt);
    }
  }

  // Nobody left to ring.
  lock.inbound.ringing = { kind: null };
  lock.inbound.exhausted = true;
  await lock.save();
  await giveUp(lock, 'nobody free');
  await redirectCustomer(lock, answerUrl(`crmCallId=${lock._id}&leg=inbound-sorry`));
  return false;
}

// Someone's phone picked up (leg=agent). Returns the XML for THEIR leg.
async function answered(rec, agentId, callUuid, extra = {}) {
  const fresh = await Rec().findById(rec._id);
  if (!fresh) return null;
  const isForward = fresh.agentLegAnswered && fresh.inbound.ringing && fresh.inbound.ringing.kind === 'forward';
  const ringingId = fresh.inbound.ringing && fresh.inbound.ringing.agent;
  if (!extra.line && String(ringingId) !== String(agentId)) return 'stale';
  if (!isLive(fresh)) return 'gone';

  const a = await Admin().findById(agentId).select('name surname').lean();
  const name = fullName(a);
  const kind = extra.kind || (fresh.inbound.ringing && fresh.inbound.ringing.kind);
  const prevAgent = fresh.agent;
  const prevUuid = fresh.agentLegCallUuid;

  const att = [...fresh.inbound.attempts].reverse().find((x) => String(x.agent) === String(agentId) && x.result === 'ringing');
  if (att) att.result = 'answered';
  fresh.agent = agentId;
  fresh.agentName = name;
  fresh.agentLegAnswered = true;
  fresh.agentLegCallUuid = callUuid || undefined;
  fresh.inbound.ringing = { kind: null };
  fresh.inbound.answeredBy = name;
  fresh.inbound.answeredKind = kind;
  if (fresh.status !== 'connected') {
    fresh.status = 'connected';
    fresh.answeredAt = fresh.answeredAt || new Date();
  }
  fresh.connectMode = extra.line ? 'alwaysOn' : fresh.connectMode || 'classic';
  if (isForward) {
    fresh.transferredToAgent = agentId;
    fresh.transferredTo = name;
    fresh.transferStatus = 'completed';
  }
  fresh.phaseAt = new Date();
  fresh.markModified('inbound');
  await fresh.save();
  await State().updateOne({ agent: agentId }, { $set: { status: 'OnCall', currentCall: fresh._id, since: new Date(), lastSeenAt: new Date() } });
  notifyAgentCallEvent(agentId, 'call:connected', fresh).catch(() => {});

  if (isForward) {
    // hand-over done: drop the forwarder's leg, free them. If the forwarder
    // had already hung up, the customer is on hold — bring them back in.
    if (prevUuid) await hangupCall(prevUuid);
    else await redirectCustomer(fresh, answerUrl(`crmCallId=${fresh._id}&leg=join`));
    await settleAgent(prevAgent, { inc: true });
    notifyAgentCallEvent(prevAgent, 'call:ended', { ...fresh.toObject(), forwardedTo: name }).catch(() => {});
  } else if (extra.line) {
    const modes = require('./connectModes');
    await redirectCustomer(fresh, answerUrl(`crmCallId=${fresh._id}&leg=inbound-room&agentId=${agentId}`));
    setTimeout(() => modes.recordCustomerCall(fresh).catch(() => {}), 1500);
  } else {
    // customer is in the hold loop — pull them into the conference now
    await redirectCustomer(fresh, answerUrl(`crmCallId=${fresh._id}&leg=join`));
  }
  broadcast(fresh);
  return 'ok';
}

// Back to the pool (Wrapup → Available) or Offline if they weren't in it.
async function settleAgent(agentId, { inc = false } = {}) {
  if (!agentId) return;
  const st = await State().findOne({ agent: agentId }).select('campaign').lean();
  await State().updateOne(
    { agent: agentId },
    {
      $set: { status: st && st.campaign ? 'Wrapup' : 'Offline', currentCall: null, since: new Date(), lastSeenAt: new Date() },
      ...(inc ? { $inc: { callsToday: 1 } } : {}),
    }
  );
}

// leg=agent-hangup for an inbound call. `agentId` says whose leg ended.
async function legEnded(rec, agentId, cause) {
  const fresh = await Rec().findById(rec._id);
  if (!fresh) return;
  const ringing = fresh.inbound.ringing || {};

  // The phone we were ringing came back unanswered.
  if (ringing.agent && String(ringing.agent) === String(agentId)) {
    const att = [...fresh.inbound.attempts].reverse().find((x) => String(x.agent) === String(agentId) && x.result === 'ringing');
    if (att) {
      att.result = 'missed';
      att.endedAt = new Date();
    }
    const wasForward = ringing.kind === 'forward';
    fresh.inbound.ringing = { kind: null };
    fresh.markModified('inbound');
    await fresh.save();
    await release(agentId, fresh._id, ringing.prevStatus);
    if (att && att.device === 'browser') {
      // stuck browser phone — rebuild it before it counts as ready again
      await State().updateOne({ agent: agentId }, { $set: { browserReadyAt: null, browserResetNeeded: true } });
      console.log(`[inbound] ${ringing.agentName}: browser leg not answered (${cause || 'no answer'}) — reset requested`);
    }
    notifyAgentCallEvent(agentId, 'call:missed', fresh).catch(() => {});
    if (wasForward) {
      notifyAgentCallEvent(fresh.agent, 'call:forward-failed', { ...fresh.toObject(), forwardTo: ringing.agentName }).catch(() => {});
      // forwarder already left too → put the customer back on hold and route
      if (!fresh.agentLegCallUuid && isLive(fresh)) {
        await Rec().updateOne({ _id: fresh._id }, { $set: { agentLegAnswered: false, agent: null, agentName: null, status: 'ringing', phaseAt: new Date() } });
        await redirectCustomer(fresh, answerUrl(`crmCallId=${fresh._id}&leg=inbound-hold&n=1`));
        await ringNext(fresh._id);
      }
    } else if (isLive(fresh) && !fresh.agentLegAnswered) {
      await ringNext(fresh._id);
    }
    broadcast(fresh);
    return;
  }

  // The person talking to the customer hung up (not a forward hand-over):
  // end the customer's call too, so they aren't left in an empty room.
  if (fresh.agentLegAnswered && String(fresh.agent) === String(agentId) && isLive(fresh)) {
    if (ringing.kind === 'forward' && ringing.agent) {
      // they hung up while the forward target is still ringing — keep the
      // customer on hold until the target answers (or misses → re-route)
      await Rec().updateOne({ _id: fresh._id }, { $set: { agentLegCallUuid: null } });
      await redirectCustomer(fresh, answerUrl(`crmCallId=${fresh._id}&leg=inbound-hold&n=1`));
      return;
    }
    await require('./connectModes').hangupCustomer(fresh);
  }
}

// Forward the live call to another user. `by` is the request's admin.
async function forward(rec, by, toAgentId) {
  if (!isLive(rec) || !rec.agentLegAnswered) return { ok: false, error: 'This call is not live any more.' };
  if (rec.inbound && rec.inbound.ringing && rec.inbound.ringing.agent) return { ok: false, error: 'Already ringing someone — wait a moment.' };
  if (String(toAgentId) === String(rec.agent)) return { ok: false, error: 'They are already on this call.' };
  const u = await usable(toAgentId, { online: onlineIds(), needPresence: false });
  if (!u) return { ok: false, error: 'That user is busy, on a break, or has no phone to ring.' };
  if (u.device.kind === 'line') u.device = { kind: 'mobile', to: `${pv().countryCode}${last10(u.admin.phone || u.admin.mobile || u.admin.contactNumber)}` };
  const name = fullName(u.admin);
  const prevStatus = await claim(toAgentId, name, rec._id);
  if (prevStatus === null) return { ok: false, error: 'That user just got another call.' };
  try {
    const reqId = await placeLeg(rec, toAgentId, u.device.to);
    await Rec().updateOne(
      { _id: rec._id },
      {
        $set: {
          'inbound.ringing': { agent: toAgentId, agentName: name, kind: 'forward', prevStatus, at: new Date() },
          'inbound.forwardedBy': fullName(by),
          agentLegRequestId: reqId ? String(reqId) : undefined,
          transferStatus: 'ringing',
          transferredTo: name,
        },
        $push: { 'inbound.attempts': { agent: toAgentId, agentName: name, kind: 'forward', device: u.device.kind, at: new Date(), result: 'ringing' } },
      }
    );
    const fresh = await Rec().findById(rec._id).lean();
    notifyAgentCallEvent(toAgentId, 'call:incoming', { ...fresh, ringingKind: 'forward', forwardedBy: fullName(by) }).catch(() => {});
    broadcast(fresh);
    return { ok: true, name };
  } catch (err) {
    await release(toAgentId, rec._id, prevStatus);
    return { ok: false, error: err.message };
  }
}

// The customer's call is over (webhook). Free whoever was still ringing;
// a call nobody answered becomes a missed call with a callback.
async function customerGone(rec) {
  const fresh = await Rec().findById(rec._id);
  if (!fresh || !fresh.inbound) return;
  const ringing = fresh.inbound.ringing || {};
  if (ringing.agent) {
    await cancelRequest(fresh.agentLegRequestId);
    await release(ringing.agent, fresh._id, ringing.prevStatus);
    const att = [...fresh.inbound.attempts].reverse().find((x) => String(x.agent) === String(ringing.agent) && x.result === 'ringing');
    if (att) {
      att.result = 'cancelled';
      att.endedAt = new Date();
    }
    fresh.inbound.ringing = { kind: null };
    fresh.markModified('inbound');
    await fresh.save();
  }
  // Plivo's duration covers the whole call incl. hold — keep talk time only.
  const talk = fresh.agentLegAnswered && fresh.answeredAt ? Math.max(0, Math.round((new Date(fresh.endedAt || Date.now()) - new Date(fresh.answeredAt)) / 1000)) : 0;
  if (fresh.duration !== talk) await Rec().updateOne({ _id: fresh._id }, { $set: { duration: talk } });
  if (fresh.agentLegAnswered && fresh.agent) {
    await settleAgent(fresh.agent); // the webhook already counted the call
  } else {
    await giveUp(fresh, 'caller hung up');
  }
  broadcast(fresh);
}

// Missed inbound: one callback, owed by whoever is closest to this customer.
async function giveUp(rec, why) {
  const claimed = await Rec().findOneAndUpdate(
    { _id: rec._id, 'inbound.callbackCreated': { $ne: true } },
    { $set: { 'inbound.callbackCreated': true, 'inbound.missed': true, missedByAgent: true, missedByAgentAt: new Date() } },
    { new: true }
  );
  if (!claimed) return;
  const tried = (claimed.inbound.attempts || []).filter((x) => x.agent);
  const ownerId = claimed.inbound.stickyAgent || (tried[0] && tried[0].agent);
  const owner = ownerId ? await Admin().findById(ownerId).select('name surname').lean() : null;
  const who = tried.length ? `Rang: ${tried.map((x) => `${x.agentName} (${x.result})`).join(', ')}.` : 'Nobody was free to ring.';
  await new (mongoose.model('CallCallback'))({
    callRecord: claimed._id,
    contactName: claimed.contactName || claimed.phone,
    phone: claimed.phone,
    scheduledAt: new Date(),
    assignedAgent: owner ? owner._id : undefined,
    assignedAgentName: owner ? fullName(owner) : undefined,
    notes: `Missed inbound call (${why}). ${who}`,
    createdByName: 'Inbound (auto)',
  })
    .save()
    .catch((e) => console.error('[inbound] callback save failed:', e.message));
  if (owner) notifyAgentCallEvent(owner._id, 'call:inbound-missed', claimed).catch(() => {});
}

// Management + the users involved get a live "call is coming in" feed.
function broadcast(rec) {
  try {
    // just a nudge — the page re-reads through the scoped API
    require('../../socket').emitCallBroadcast('inbound:update', { _id: String(rec._id), status: rec.status });
  } catch {
    /* socket not up (serverless) — the page polls anyway */
  }
}

module.exports = {
  RING_SEC,
  MAX_HOLD_LOOPS,
  start,
  ringNext,
  answered,
  legEnded,
  forward,
  customerGone,
  giveUp,
  usable,
  onlineIds,
  fullName,
};
