const mongoose = require('mongoose');
const CallingProvider = require('./CallingProvider');
const {
  last10,
  secs,
  setAgent,
  wrapupAgent,
  resolveLead,
  recountCampaign,
  withinCallingHours,
} = require('./callingShared');

// CRM-side provider for CALLING_PROVIDER=cloud.
//
// Two Edesy products are supported side by side:
//   • number masking  (voice-api.edesy.in) — 1:1 bridge: agent phone rings
//     first, then the customer. Drives placeCall / dialNext / the auto-dialer.
//   • voice-agent     (voice-agent.edesy.in) — IVR menus, DTMF, in-call
//     transfer. Used by transfer() and inbound IVR (see cloudWebhook.js).
//
// Real call state (answered / ended / recording / DTMF) always arrives on
// POST /api/cloud-call/webhook — the provider dashboard is configured to hit it.
//
// Adding Exotel/Twilio/… later is a new entry in ADAPTERS, nothing else.

const digitsOnly = (s) => String(s || '').replace(/[^\d]/g, '');

// ── provider adapters ─────────────────────────────────────────────────
const ADAPTERS = {
  // Tata Smartflo — https://api-smartflo.tatateleservices.com/v1/click_to_call
  tata: {
    buildClickToCall(cfg, { agentNumber, customerNumber, callerId, crmCallId }) {
      return {
        url: `${cfg.apiBase}/v1/click_to_call`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: {
          agent_number: agentNumber,
          destination_number: customerNumber,
          caller_id: callerId,
          async: 1,
          get_call_id: 1,
          custom_identifier: crmCallId,
        },
      };
    },
    parseClickToCall(json, httpOk) {
      const ok = httpOk && (json.success === true || json.success === 'true' || /success/i.test(json.message || ''));
      return ok
        ? { ok: true, providerCallId: json.call_id || json.callId || json.uuid || undefined }
        : { ok: false, error: json.message || json.error || 'Provider rejected the call request.' };
    },
  },

  // Exotel — https://<sid>:<token>@api.exotel.com/v1/Accounts/<sid>/Calls/connect.json
  exotel: {
    buildClickToCall(cfg, { agentNumber, customerNumber, callerId, crmCallId }) {
      const base = cfg.apiBase.replace('https://', `https://${cfg.apiKey}:${cfg.apiToken}@`);
      const params = new URLSearchParams({
        From: agentNumber,
        To: customerNumber,
        CallerId: callerId,
        CallType: 'trans',
        StatusCallback: '',
        CustomField: crmCallId,
      });
      return {
        url: `${base}/v1/Accounts/${cfg.accountSid}/Calls/connect.json`,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        rawBody: true,
      };
    },
    parseClickToCall(json, httpOk) {
      const call = json && json.Call;
      return httpOk && call
        ? { ok: true, providerCallId: call.Sid }
        : { ok: false, error: (json && json.RestException && json.RestException.Message) || 'Exotel rejected the call.' };
    },
  },

  // Edesy number masking — POST https://voice-api.edesy.in/v1/masking/calls
  // party_a (agent) is dialled first, then party_b (customer). Edesy picks
  // the masked caller-ID itself, so caller_id is NOT sent. Correlation is by
  // the returned call_sid.
  edesy: {
    buildClickToCall(cfg, { agentNumber, customerNumber }) {
      return {
        url: `${cfg.apiBase}/masking/calls`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey || cfg.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: {
          party_a: agentNumber,
          party_b: customerNumber,
          max_duration_sec: 3600,
        },
      };
    },
    parseClickToCall(json, httpOk) {
      const d = (json && json.data) || {};
      if (httpOk && d.call_sid) return { ok: true, providerCallId: d.call_sid };
      const err =
        (json && json.error && (json.error.message || json.error.code)) ||
        (json && json.message) ||
        (typeof (json && json.error) === 'string' ? json.error : '') ||
        'Edesy rejected the call request.';
      return { ok: false, error: String(err) };
    },
  },
};

class CloudCallProvider extends CallingProvider {
  get name() {
    return 'cloud';
  }

  get _cfg() {
    return this.config.cloud;
  }

  get _adapter() {
    return ADAPTERS[this._cfg.provider] || ADAPTERS.tata;
  }

  get _ready() {
    return !!((this._cfg.apiToken || this._cfg.apiKey) && this._cfg.callerId);
  }

  get _voiceReady() {
    return !!(this._cfg.voiceKey && this._cfg.voiceBase);
  }

  async _fetchJson(url, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this._cfg.timeoutMs || 8000);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      const text = await res.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch (e) {
        json = { raw: text };
      }
      return { ok: res.ok, status: res.status, json };
    } catch (err) {
      return { ok: false, status: 0, json: {}, error: err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  async _clickToCall({ agentNumber, customerNumber, callerId, crmCallId }) {
    if (!this._ready) {
      return {
        ok: false,
        error: 'Cloud calling not configured (CLOUD_CALL_API_TOKEN or CLOUD_CALL_API_KEY, plus CLOUD_CALL_CALLER_ID).',
        code: 'not_configured',
      };
    }
    const spec = this._adapter.buildClickToCall(this._cfg, {
      agentNumber,
      customerNumber,
      callerId: callerId || this._cfg.callerId,
      crmCallId,
    });
    const r = await this._fetchJson(spec.url, {
      method: spec.method,
      headers: spec.headers,
      body: spec.rawBody ? spec.body : JSON.stringify(spec.body),
    });
    if (r.error) return { ok: false, error: `Cloud calling provider unreachable: ${r.error}`, code: 'unreachable' };
    const parsed = this._adapter.parseClickToCall(r.json, r.ok);
    return { ...parsed, httpStatus: r.status, providerRaw: r.json };
  }

  async status() {
    return {
      provider: 'cloud',
      testMode: false,
      online: this._ready,
      label: `Cloud Calling · ${this._cfg.provider}`,
      detail: this._ready
        ? `${this._cfg.provider} · caller ID ${this._cfg.callerId} · calls bridge on the provider (agent phone rings first)` +
          (this._voiceReady ? ' · IVR + transfer enabled' : '')
        : 'Set CLOUD_CALL_API_TOKEN or CLOUD_CALL_API_KEY, and CLOUD_CALL_CALLER_ID (plus CLOUD_CALL_PROVIDER / API_BASE).',
      sipOutboundEnabled: this._ready,
      ivrEnabled: this._voiceReady,
    };
  }

  // ── manual / quick "Call this lead" — agent phone ⇄ customer, bridged ──
  async placeCall({ agent, agentPhone, phone, contactName, callLead, campaign }) {
    const CallRecord = mongoose.model('CallRecord');
    const agentNumber = agentPhone || agent.phone || agent.mobile || agent.contactNumber;
    if (!agentNumber) {
      return { ok: false, error: 'No agent phone number — save your number once so the provider can ring you first.' };
    }

    const now = new Date();
    const rec = await new CallRecord({
      campaign: campaign || undefined,
      callLead: callLead || undefined,
      agent: agent._id,
      agentName: `${agent.name} ${agent.surname || ''}`.trim(),
      contactName: contactName || 'Cloud Call',
      phone: String(phone).trim(),
      direction: 'Outbound',
      status: 'dialing',
      phaseAt: now,
      queuedAt: now,
      provider: 'cloud',
      isMock: false,
    }).save();

    const r = await this._clickToCall({
      agentNumber: last10(agentNumber),
      customerNumber: last10(phone),
      crmCallId: String(rec._id),
    });

    if (!r.ok) {
      rec.status = 'failed';
      rec.endedAt = new Date();
      rec.notes = r.error;
      await rec.save();
      await setAgent(agent._id, { status: 'Available', currentCall: null, since: new Date() });
      return { ok: false, error: r.error, code: r.code };
    }

    rec.providerCallId = r.providerCallId || `cloud-${rec._id}`;
    await rec.save();
    await setAgent(agent._id, {
      status: 'Ringing',
      currentCall: rec._id,
      campaign: campaign || null,
      since: new Date(),
      agentName: rec.agentName,
    });
    return { ok: true, callRecord: rec };
  }

  async startCampaign() {
    return { ok: true, status: 'Active' };
  }
  async pauseCampaign() {
    return { ok: true, status: 'Paused' };
  }
  async stopCampaign() {
    return { ok: true, status: 'Completed' };
  }

  // ── pick + dial the next eligible lead for one agent ──────────────────
  async dialNext({ campaign, agent }) {
    const CallLead = mongoose.model('CallLead');

    const maxAttempts = Math.max(1, campaign.maxAttempts || 3);
    const retryBefore = new Date(Date.now() - (campaign.retryDelayMin || 30) * 60 * 1000);

    const lead = await CallLead.findOneAndUpdate(
      {
        campaign: campaign._id,
        removed: false,
        dncAt: { $exists: false },
        $or: [
          { status: { $in: ['New', 'Queued'] } },
          {
            status: { $in: ['No Answer', 'Busy', 'Voicemail', 'Failed'] },
            attempts: { $lt: maxAttempts },
            lastAttemptAt: { $lt: retryBefore },
          },
        ],
      },
      { $set: { status: 'Dialing', lastAttemptAt: new Date(), assignedAgent: agent._id }, $inc: { attempts: 1 } },
      { sort: { attempts: 1, created: 1 }, new: true }
    );
    if (!lead) return { ok: false, error: 'No leads waiting in this campaign.' };

    const r = await this.placeCall({
      agent,
      phone: lead.phone,
      contactName: lead.name,
      callLead: lead._id,
      campaign: campaign._id,
    });

    if (!r.ok) {
      // Roll the lead back so it's retried, not stuck in "Dialing".
      await CallLead.updateOne(
        { _id: lead._id },
        { $set: { status: lead.attempts >= maxAttempts ? 'Failed' : 'Queued' } }
      );
      return r;
    }
    r.callRecord.team = campaign.team;
    r.callRecord.callerId = campaign.callerId || this._cfg.callerId;
    if (campaign.ivrFlow) r.callRecord.ivrFlow = campaign.ivrFlow;
    await r.callRecord.save();
    return r;
  }

  async answer(callRecord) {
    // The provider bridges automatically; nothing to POST. Reflect state.
    if (['dialing', 'ringing'].includes(callRecord.status)) {
      callRecord.status = 'connected';
      callRecord.answeredAt = callRecord.answeredAt || new Date();
      callRecord.phaseAt = new Date();
      await callRecord.save();
      await setAgent(callRecord.agent, { status: 'OnCall', currentCall: callRecord._id });
    }
    return { ok: true, callRecord };
  }

  async hold({ callRecord }) {
    return { ok: false, error: 'Hold is not available on the cloud calling provider.', code: 'unsupported', callRecord };
  }
  async mute({ callRecord }) {
    return { ok: false, error: 'Mute is not available on the cloud calling provider.', code: 'unsupported', callRecord };
  }

  // ── in-call transfer ─────────────────────────────────────────────────
  // Real transfer needs the voice-agent product. Without it, the masking
  // bridge can't move a live leg — we surface that cleanly.
  async transfer({ callRecord, target, toAgent, toNumber, actorName }) {
    if (!['connected', 'onhold', 'ringing'].includes(callRecord.status)) {
      return { ok: false, error: 'Only a live call can be transferred.' };
    }
    const dest = toNumber || (toAgent && (toAgent.phone || toAgent.mobile || toAgent.contactNumber));

    if (!this._voiceReady) {
      return {
        ok: false,
        code: 'unsupported',
        error:
          'In-call transfer needs the Edesy voice-agent product (set CLOUD_CALL_VOICE_KEY). Number-masking calls cannot be transferred mid-call.',
        callRecord,
      };
    }
    if (!dest) {
      return { ok: false, error: 'No transfer destination number (agent has no phone / no number given).', callRecord };
    }

    const r = await this._fetchJson(`${this._cfg.voiceBase}/calls/${callRecord.providerCallId}/transfer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this._cfg.voiceKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ to: digitsOnly(dest), workspace_id: this._cfg.workspaceId || undefined }),
    });
    if (r.error || !r.ok) {
      return { ok: false, error: r.error || `Provider refused the transfer (HTTP ${r.status}).`, callRecord };
    }

    const now = new Date();
    callRecord.status = 'transferred';
    callRecord.endedAt = now;
    callRecord.phaseAt = now;
    callRecord.duration = callRecord.answeredAt ? secs(callRecord.answeredAt, now) : 0;
    callRecord.transferredTo = target || (toAgent ? 'Agent' : 'Number');
    callRecord.transferredToNumber = digitsOnly(dest);
    if (toAgent) callRecord.transferredToAgent = toAgent._id;
    callRecord.transferStatus = 'completed';
    await callRecord.save();

    await resolveLead(callRecord, 'INTERESTED');
    await wrapupAgent(callRecord, actorName);
    await recountCampaign(callRecord.campaign);
    return { ok: true, callRecord };
  }

  async hangup({ callRecord, disposition, notes, actorName }) {
    if (disposition) callRecord.disposition = disposition;
    if (notes != null) callRecord.notes = notes;

    // Best-effort: ask the voice-agent to drop the call if we own that leg.
    if (this._voiceReady && callRecord.providerCallId && !String(callRecord.providerCallId).startsWith('cloud-')) {
      await this._fetchJson(`${this._cfg.voiceBase}/calls/${callRecord.providerCallId}/hangup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this._cfg.voiceKey}`, Accept: 'application/json' },
      });
    }

    if (!['completed', 'transferred', 'cancelled', 'failed'].includes(callRecord.status)) {
      callRecord.status = 'completed';
      callRecord.endedAt = callRecord.endedAt || new Date();
      if (callRecord.answeredAt && !callRecord.duration) {
        callRecord.duration = secs(callRecord.answeredAt, callRecord.endedAt);
      }
    }
    await callRecord.save();
    await resolveLead(callRecord, disposition);
    await wrapupAgent(callRecord, actorName);
    await recountCampaign(callRecord.campaign);
    return { ok: true, callRecord };
  }

  async getRecording(callRecord) {
    const rec = callRecord.recording || {};
    return {
      status: rec.status || 'unavailable',
      durationSec: rec.durationSec || 0,
      readyAt: rec.readyAt || null,
      url: rec.url || null,
      streamUrl: null,
    };
  }

  // ── auto-dialer engine ───────────────────────────────────────────────
  // Called by the callingDialerTick job (and by the read endpoints as a
  // serverless fallback). Idempotent, safe to run every few seconds.
  async tick() {
    const CallRecord = mongoose.model('CallRecord');
    const CallLead = mongoose.model('CallLead');
    const CallCampaign = mongoose.model('CallCampaign');
    const AgentCallState = mongoose.model('AgentCallState');
    const Admin = mongoose.model('Admin');

    const now = Date.now();
    let advanced = 0;
    const touched = new Set();

    // 1. Stuck dials: no webhook after 120s → mark failed, free the agent.
    const stuckBefore = new Date(now - 120 * 1000);
    const stuck = await CallRecord.find({
      provider: 'cloud',
      status: { $in: ['dialing', 'ringing'] },
      phaseAt: { $lte: stuckBefore },
    })
      .limit(100)
      .exec();
    for (const rec of stuck) {
      rec.status = 'failed';
      rec.endedAt = new Date();
      rec.phaseAt = new Date();
      rec.notes = rec.notes || 'No provider callback — timed out.';
      await rec.save();
      await CallLead.updateOne(
        { _id: rec.callLead, status: 'Dialing' },
        { $set: { status: 'Failed' } }
      );
      await setAgent(rec.agent, { status: 'Wrapup', currentCall: null, since: new Date() });
      if (rec.campaign) touched.add(String(rec.campaign));
      advanced++;
    }

    // 2. Wrapup → Available after 8s (short; agents pause manually to hold).
    const wrapupBefore = new Date(now - 8 * 1000);
    const wr = await AgentCallState.updateMany(
      { status: 'Wrapup', since: { $lte: wrapupBefore } },
      { $set: { status: 'Available', currentCall: null, since: new Date() } }
    );
    advanced += wr.modifiedCount || 0;

    // 3. Auto-dial Available agents on Active auto-dial campaigns.
    const campaigns = await CallCampaign.find({
      removed: false,
      status: 'Active',
      autoDial: { $ne: false },
    })
      .limit(25)
      .exec();

    for (const camp of campaigns) {
      if (!camp.agents || !camp.agents.length) continue;
      if (!withinCallingHours(camp)) continue;

      const ratio = Math.max(1, camp.dialRatio || 1);
      const [freeStates, inFlight] = await Promise.all([
        AgentCallState.find({ agent: { $in: camp.agents }, status: 'Available' }).limit(50).lean(),
        CallRecord.countDocuments({
          campaign: camp._id,
          removed: false,
          status: { $in: ['dialing', 'ringing'] },
        }),
      ]);

      // lines allowed right now = (available agents × ratio) − already ringing
      let budget = freeStates.length * ratio - inFlight;
      if (budget <= 0) continue;

      for (const st of freeStates) {
        if (budget <= 0) break;
        const admin = await Admin.findById(st.agent).select('name surname phone mobile contactNumber').lean();
        if (!admin) continue;
        if (!(admin.phone || admin.mobile || admin.contactNumber)) continue; // can't ring them
        const r = await this.dialNext({ campaign: camp, agent: admin });
        if (r.ok) {
          advanced++;
          budget--;
          touched.add(String(camp._id));
        } else if (/No leads waiting/.test(r.error || '')) {
          break; // campaign drained
        }
      }
    }

    for (const cid of touched) await recountCampaign(cid);
    return { advanced };
  }
}

module.exports = CloudCallProvider;
