const mongoose = require('mongoose');
const CallingProvider = require('./CallingProvider');
const { BY_CODE } = require('./dispositions');

// Deterministic, time-driven call simulation. NO real calls, NO timers /
// background loops (serverless-safe): every call's state is a pure function
// of its timestamps + a per-call seed, advanced whenever `tick()` runs
// (which the read endpoints call first). Reproducible and idempotent.

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
// Stable pseudo-random in [0,1) from a call seed + a salt.
function seeded(seed, salt) {
  return (hashStr(`${seed}|${salt}`) % 100000) / 100000;
}
function pickOutcome(r, weights) {
  let acc = 0;
  for (const [k, w] of Object.entries(weights)) {
    acc += w;
    if (r < acc) return k;
  }
  return 'no-answer';
}
const secs = (from, to) => Math.max(0, Math.round((to - from) / 1000));

class MockCallingProvider extends CallingProvider {
  get name() {
    return 'mock';
  }

  async status() {
    return {
      provider: 'mock',
      testMode: true,
      online: true,
      label: 'Mock / Test Provider',
      detail: 'Simulated calls only — connect a VICIdial server to go live.',
    };
  }

  async startCampaign() {
    return { ok: true };
  }
  async pauseCampaign() {
    return { ok: true };
  }
  async stopCampaign() {
    return { ok: true };
  }

  // ── place next dial for an agent ──────────────────────────────────────
  async dialNext({ campaign, agent }) {
    const CallLead = mongoose.model('CallLead');
    const CallRecord = mongoose.model('CallRecord');
    const AgentCallState = mongoose.model('AgentCallState');

    const retryBefore = new Date(Date.now() - 60 * 1000);
    const lead = await CallLead.findOneAndUpdate(
      {
        campaign: campaign._id,
        removed: false,
        $or: [
          { status: { $in: ['New', 'Queued'] } },
          {
            status: { $in: ['No Answer', 'Busy', 'Voicemail'] },
            attempts: { $lt: 3 },
            lastAttemptAt: { $lt: retryBefore },
          },
        ],
      },
      { $set: { status: 'Dialing', lastAttemptAt: new Date(), assignedAgent: agent._id }, $inc: { attempts: 1 } },
      { sort: { attempts: 1, created: 1 }, new: true }
    );
    if (!lead) return { ok: false, error: 'No leads waiting in this campaign.' };

    const now = new Date();
    const rec = await new CallRecord({
      campaign: campaign._id,
      callLead: lead._id,
      agent: agent._id,
      agentName: `${agent.name} ${agent.surname || ''}`.trim(),
      contactName: lead.name,
      phone: lead.phone,
      direction: 'Outbound',
      status: 'dialing',
      phaseAt: now,
      queuedAt: now,
      provider: 'mock',
      providerCallId: `mock-${hashStr(`${lead._id}${now.getTime()}${Math.random()}`)}`,
      isMock: true,
      team: campaign.team,
    }).save();

    await AgentCallState.updateOne(
      { agent: agent._id },
      { $set: { agentName: rec.agentName, status: 'Ringing', campaign: campaign._id, currentCall: rec._id, since: now, lastSeenAt: now } },
      { upsert: true }
    );

    return { ok: true, callRecord: rec };
  }

  async answer(callRecord) {
    if (!['dialing', 'ringing'].includes(callRecord.status)) return { ok: true, callRecord };
    const now = new Date();
    callRecord.status = 'connected';
    callRecord.answeredAt = now;
    callRecord.phaseAt = now;
    await callRecord.save();
    await this._setAgent(callRecord.agent, { status: 'OnCall', currentCall: callRecord._id });
    await mongoose.model('CallLead').updateOne({ _id: callRecord.callLead }, { $set: { status: 'Connected' } });
    return { ok: true, callRecord };
  }

  async hold({ callRecord, on }) {
    if (!['connected', 'onhold'].includes(callRecord.status)) return { ok: false, error: 'Call is not connected.' };
    callRecord.onHold = !!on;
    callRecord.status = on ? 'onhold' : 'connected';
    callRecord.phaseAt = new Date();
    await callRecord.save();
    return { ok: true, callRecord };
  }

  async mute({ callRecord, on }) {
    callRecord.muted = !!on;
    await callRecord.save();
    return { ok: true, callRecord };
  }

  async hangup({ callRecord, disposition, notes, actorName }) {
    if (['completed', 'transferred', 'cancelled'].includes(callRecord.status)) {
      return { ok: true, callRecord };
    }
    const now = new Date();
    const wasConnected = !!callRecord.answeredAt;
    callRecord.status = 'completed';
    callRecord.endedAt = now;
    callRecord.phaseAt = now;
    callRecord.duration = wasConnected ? secs(callRecord.answeredAt, now) : 0;
    if (disposition) callRecord.disposition = disposition;
    if (notes != null) callRecord.notes = notes;
    if (wasConnected) {
      callRecord.recording = {
        status: 'processing',
        url: null,
        durationSec: callRecord.duration,
        readyAt: new Date(now.getTime() + (this.config.mock.recordingProcessingSeconds || 10) * 1000),
      };
    }
    await callRecord.save();

    await this._resolveLead(callRecord, disposition);
    await this._wrapupAgent(callRecord, actorName);
    await this._recountCampaign(callRecord.campaign);
    return { ok: true, callRecord };
  }

  async transfer({ callRecord, target, toAgent, actorName }) {
    if (!['connected', 'onhold'].includes(callRecord.status)) {
      return { ok: false, error: 'Only a connected call can be transferred.' };
    }
    const CallRecord = mongoose.model('CallRecord');
    const now = new Date();

    callRecord.status = 'transferred';
    callRecord.endedAt = now;
    callRecord.phaseAt = now;
    callRecord.duration = callRecord.answeredAt ? secs(callRecord.answeredAt, now) : 0;
    callRecord.transferredTo = target || (toAgent ? 'Agent' : 'Queue');
    if (toAgent) callRecord.transferredToAgent = toAgent._id;
    if (callRecord.answeredAt) {
      callRecord.recording = {
        status: 'processing',
        url: null,
        durationSec: callRecord.duration,
        readyAt: new Date(now.getTime() + (this.config.mock.recordingProcessingSeconds || 10) * 1000),
      };
    }
    await callRecord.save();

    // The transferred leg — in mock it connects instantly.
    const leg = await new CallRecord({
      campaign: callRecord.campaign,
      callLead: callRecord.callLead,
      agent: toAgent ? toAgent._id : undefined,
      agentName: toAgent ? `${toAgent.name} ${toAgent.surname || ''}`.trim() : target,
      contactName: callRecord.contactName,
      phone: callRecord.phone,
      direction: 'Outbound',
      status: 'connected',
      phaseAt: now,
      queuedAt: now,
      answeredAt: now,
      notes: `Transferred from ${callRecord.agentName || 'agent'}`,
      provider: 'mock',
      providerCallId: `mock-${hashStr(`xfer${callRecord._id}${now.getTime()}`)}`,
      isMock: true,
      team: callRecord.team,
    }).save();

    if (toAgent) await this._setAgent(toAgent._id, { status: 'OnCall', currentCall: leg._id, agentName: leg.agentName, campaign: callRecord.campaign });
    await this._wrapupAgent(callRecord, actorName);
    return { ok: true, callRecord: leg, from: callRecord };
  }

  async getRecording(callRecord) {
    const r = callRecord.recording || {};
    return {
      status: r.status || 'unavailable',
      durationSec: r.durationSec || 0,
      readyAt: r.readyAt || null,
      url: null, // mock never serves audio
      testNote: 'Test mode — no audio file. A real recording URL appears here once VICIdial is connected.',
    };
  }

  // ── the simulation tick ──────────────────────────────────────────────
  async tick() {
    const CallRecord = mongoose.model('CallRecord');
    const CallLead = mongoose.model('CallLead');
    const CallCampaign = mongoose.model('CallCampaign');
    const AgentCallState = mongoose.model('AgentCallState');

    const now = Date.now();
    const M = this.config.mock;
    let advanced = 0;
    const touchedCampaigns = new Set();

    // 1. progress live calls
    const live = await CallRecord.find({
      isMock: true,
      status: { $in: ['dialing', 'ringing', 'connected', 'onhold'] },
    })
      .limit(120)
      .exec();

    for (const rec of live) {
      const seed = rec.providerCallId;
      const phaseAge = (now - new Date(rec.phaseAt).getTime()) / 1000;
      let changed = false;

      if (rec.status === 'dialing' && phaseAge >= M.dialSeconds) {
        rec.status = 'ringing';
        rec.ringingAt = new Date();
        rec.phaseAt = new Date();
        changed = true;
      } else if (rec.status === 'ringing') {
        const ringLen = M.ringSecondsMin + seeded(seed, 'ring') * (M.ringSecondsMax - M.ringSecondsMin);
        if (phaseAge >= ringLen) {
          const outcome = pickOutcome(seeded(seed, 'outcome'), M.outcomeWeights);
          if (outcome === 'connected') {
            rec.status = 'connected';
            rec.answeredAt = new Date();
            rec.phaseAt = new Date();
            await this._setAgent(rec.agent, { status: 'OnCall', currentCall: rec._id });
            await CallLead.updateOne({ _id: rec.callLead }, { $set: { status: 'Connected' } });
          } else {
            rec.status = outcome; // no-answer | busy | failed | voicemail
            rec.endedAt = new Date();
            rec.phaseAt = new Date();
            rec.duration = 0;
            const leadStatus = { 'no-answer': 'No Answer', busy: 'Busy', failed: 'Failed', voicemail: 'Voicemail' }[outcome];
            await CallLead.updateOne({ _id: rec.callLead }, { $set: { status: leadStatus } });
            await this._setAgent(rec.agent, { status: 'Available', currentCall: null, since: new Date() });
          }
          changed = true;
        }
      } else if ((rec.status === 'connected' || rec.status === 'onhold') && rec.answeredAt) {
        const talk = (now - new Date(rec.answeredAt).getTime()) / 1000;
        if (talk >= M.maxTalkSeconds) {
          rec.status = 'completed';
          rec.endedAt = new Date();
          rec.phaseAt = new Date();
          rec.duration = Math.round(talk);
          rec.recording = {
            status: 'processing',
            url: null,
            durationSec: rec.duration,
            readyAt: new Date(now + M.recordingProcessingSeconds * 1000),
          };
          await this._resolveLead(rec, rec.disposition);
          await this._wrapupAgent(rec);
          changed = true;
        }
      }

      if (changed) {
        advanced++;
        touchedCampaigns.add(String(rec.campaign));
        await rec.save();
      }
    }

    // 2. recordings: processing -> available
    const proc = await CallRecord.find({
      isMock: true,
      'recording.status': 'processing',
      'recording.readyAt': { $lte: new Date(now) },
    })
      .limit(120)
      .exec();
    for (const rec of proc) {
      rec.recording.status = 'available';
      rec.recording.readyAt = new Date();
      await rec.save();
      advanced++;
    }

    // 3. agents: Wrapup -> Available after wrapup window
    const wrapupBefore = new Date(now - M.wrapupSeconds * 1000);
    const wr = await AgentCallState.updateMany(
      { status: 'Wrapup', since: { $lte: wrapupBefore } },
      { $set: { status: 'Available', currentCall: null, since: new Date() } }
    );
    advanced += wr.modifiedCount || 0;

    // 4. auto-dial: Available agents on Active campaigns get the next lead
    const activeCampaigns = await CallCampaign.find({ removed: false, status: 'Active' }).limit(20).exec();
    for (const camp of activeCampaigns) {
      const agentIds = (camp.agents || []).map((a) => String(a));
      if (agentIds.length === 0) continue;
      const freeAgents = await AgentCallState.find({
        agent: { $in: camp.agents },
        status: 'Available',
      })
        .limit(Math.max(1, camp.dialRatio || 1) * agentIds.length)
        .populate('agent', 'name surname')
        .exec();
      for (const st of freeAgents) {
        if (!st.agent) continue;
        const r = await this.dialNext({ campaign: camp, agent: st.agent });
        if (r.ok) {
          advanced++;
          touchedCampaigns.add(String(camp._id));
        } else {
          break; // no leads left
        }
      }
    }

    for (const cid of touchedCampaigns) await this._recountCampaign(cid);

    return { advanced };
  }

  // ── helpers ──────────────────────────────────────────────────────────
  async _setAgent(agentId, patch) {
    if (!agentId) return;
    await mongoose.model('AgentCallState').updateOne(
      { agent: agentId },
      { $set: { ...patch, lastSeenAt: new Date() } },
      { upsert: true }
    );
  }

  async _wrapupAgent(rec) {
    if (!rec.agent) return;
    await mongoose.model('AgentCallState').updateOne(
      { agent: rec.agent },
      {
        $set: { status: 'Wrapup', currentCall: null, since: new Date(), lastSeenAt: new Date() },
        $inc: { callsToday: 1, talkSecondsToday: rec.duration || 0 },
      },
      { upsert: true }
    );
  }

  async _resolveLead(rec, dispositionCode) {
    const d = dispositionCode && BY_CODE[dispositionCode];
    let status = 'Completed';
    if (d) {
      if (d.category === 'callback') status = 'Callback';
      else if (d.category === 'dnc') status = 'DNC';
      else if (d.category === 'sale') status = 'Completed';
      else status = 'Completed';
    }
    await mongoose.model('CallLead').updateOne(
      { _id: rec.callLead },
      { $set: { status, lastDisposition: dispositionCode || undefined } }
    );
  }

  async _recountCampaign(campaignId) {
    if (!campaignId) return;
    const CallLead = mongoose.model('CallLead');
    const CallRecord = mongoose.model('CallRecord');
    const [byStatus, connected, failed] = await Promise.all([
      CallLead.aggregate([
        { $match: { campaign: new mongoose.Types.ObjectId(String(campaignId)), removed: false } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      CallRecord.countDocuments({ campaign: campaignId, removed: false, status: { $in: ['connected', 'onhold', 'completed', 'transferred'] }, answeredAt: { $ne: null } }),
      CallRecord.countDocuments({ campaign: campaignId, removed: false, status: { $in: ['failed', 'busy', 'no-answer', 'voicemail'] } }),
    ]);
    const map = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
    const total = byStatus.reduce((s, r) => s + r.n, 0);
    const pending = (map['New'] || 0) + (map['Queued'] || 0);
    const dialed = total - pending;
    await mongoose.model('CallCampaign').updateOne(
      { _id: campaignId },
      {
        $set: {
          'stats.totalLeads': total,
          'stats.pending': pending,
          'stats.dialed': dialed,
          'stats.connected': connected,
          'stats.failed': failed,
          'stats.callbacks': map['Callback'] || 0,
        },
      }
    );
  }
}

module.exports = MockCallingProvider;
