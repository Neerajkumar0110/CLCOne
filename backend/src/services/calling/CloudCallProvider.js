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

// CRM-side provider for CALLING_PROVIDER=cloud. Plivo is the sole target.
//
// Outbound calls: placeCall/dialNext dial the customer directly (no agent
// leg initiated by us); once they answer, Plivo hits our answer_url
// (plivoAnswer.js), which decides what happens next — bridging to whichever
// agent owns the CallRecord.
//
// Real call state (answered / ended / recording / DTMF) always arrives on
// POST /api/cloud-call/webhook — Plivo's dashboard is configured to hit it.

const digitsOnly = (s) => String(s || '').replace(/[^\d]/g, '');

// A failed call's `notes` is the only place to see WHY once the response
// popup is gone — include the provider's full raw JSON (not just the
// extracted message), since a generic-sounding error often carries an
// error code or detail field that `parseCall` didn't specifically look for.
function failureNote(r) {
  const msg = typeof r.error === 'string' ? r.error : JSON.stringify(r.error);
  const raw = r.providerRaw ? ` — provider raw: ${JSON.stringify(r.providerRaw)}` : '';
  const status = r.httpStatus ? ` (HTTP ${r.httpStatus})` : '';
  return `${msg}${status}${raw}`;
}

// Plivo Call API — POST https://api.plivo.com/v1/Account/{auth_id}/Call/
// Plivo has no fixed destination configured on its own portal: once the
// customer answers, WE decide what happens next
// via the Answer XML returned by answer_url (see plivoAnswer.js), which
// bridges to whichever agent owns the CallRecord. Basic-auth'd with
// auth_id:auth_token (not a Bearer token). `to`/`from` need the country
// code; customerNumber/callerId arrive as bare digits (see last10()).
const PLIVO_ADAPTER = {
  buildCall(cfg, { customerNumber, callerId, crmCallId }) {
    const p = cfg.plivo;
    const secretQs = cfg.webhookSecret ? `&secret=${encodeURIComponent(cfg.webhookSecret)}` : '';
    return {
      url: `${p.apiBase}/v1/Account/${p.authId}/Call/`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${p.authId}:${p.authToken}`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        from: digitsOnly(callerId || cfg.callerId),
        to: `${p.countryCode}${digitsOnly(customerNumber)}`,
        answer_url: `${p.publicBaseUrl}/api/cloud-call/plivo-answer?crmCallId=${crmCallId}${secretQs}`,
        answer_method: 'POST',
        hangup_url: `${p.publicBaseUrl}/api/cloud-call/webhook?crmCallId=${crmCallId}${secretQs}`,
        hangup_method: 'POST',
      },
    };
  },
  parseCall(json, httpOk) {
    if (httpOk && json && json.request_uuid) return { ok: true, providerCallId: json.request_uuid };
    const err = (json && (json.error || json.message)) || 'Plivo rejected the call request.';
    return { ok: false, error: String(err) };
  },
};

class CloudCallProvider extends CallingProvider {
  get name() {
    return 'cloud';
  }

  get _cfg() {
    return this.config.cloud;
  }

  get _ready() {
    return !!(this._cfg.plivo.authId && this._cfg.plivo.authToken && this._cfg.callerId);
  }

  // Multi-DID validation — mirrors the provider's own rule: "Please provide
  // a valid caller_id." Skipped (always valid) when no allow-list is set.
  _validCallerId(callerId) {
    if (!callerId) return true;
    if (!this._cfg.callerIds.length) return true;
    return this._cfg.callerIds.includes(String(callerId).trim());
  }

  async _fetchJson(url, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this._cfg.timeoutMs || 8000);
    try {
      // 'Connection: close' works around a real hang seen against a prior
      // provider's API: Node's fetch (undici) never resolved the response
      // body on some successful replies from that host — even the
      // AbortController timeout above never fired. Forcing the server to
      // close the connection after responding sidesteps that class of
      // keep-alive/framing quirk, so it's kept as a safe default.
      const res = await fetch(url, {
        ...opts,
        headers: { ...opts.headers, Connection: 'close' },
        signal: ctrl.signal,
      });
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

  // Places the actual call via Plivo. Used for automated/support outbound
  // dialing (e.g. a campaign) as well as agent-initiated "Call this lead".
  async _placeProviderCall({ customerNumber, callerId, crmCallId }) {
    if (!this._ready) {
      return {
        ok: false,
        error: 'Plivo not configured (PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN, plus CLOUD_CALL_CALLER_ID).',
        code: 'not_configured',
      };
    }
    if (!this._validCallerId(callerId)) {
      return { ok: false, error: 'Please provide a valid caller_id.', code: 'invalid_caller_id' };
    }
    const spec = PLIVO_ADAPTER.buildCall(this._cfg, { customerNumber, callerId: callerId || this._cfg.callerId, crmCallId });
    const r = await this._fetchJson(spec.url, {
      method: spec.method,
      headers: spec.headers,
      body: JSON.stringify(spec.body),
    });
    if (r.error) return { ok: false, error: `Cloud calling provider unreachable: ${r.error}`, code: 'unreachable' };
    const parsed = PLIVO_ADAPTER.parseCall(r.json, r.ok);
    return { ...parsed, httpStatus: r.status, providerRaw: r.json };
  }

  // "Support call" this lead — dials the customer directly (no agent leg).
  async placeSupportCall({ phone, callerId, callLead, campaign, contactName }) {
    const CallRecord = mongoose.model('CallRecord');
    const now = new Date();
    const rec = await new CallRecord({
      campaign: campaign || undefined,
      callLead: callLead || undefined,
      contactName: contactName || 'Support Call',
      phone: String(phone).trim(),
      direction: 'Outbound',
      status: 'dialing',
      phaseAt: now,
      queuedAt: now,
      provider: 'cloud',
      isMock: false,
      callerId: callerId || this._cfg.callerId || undefined,
      notes: 'Plivo outbound call',
    }).save();

    const r = await this._placeProviderCall({
      customerNumber: last10(phone),
      callerId: rec.callerId,
      crmCallId: String(rec._id),
    });

    if (!r.ok) {
      rec.status = 'failed';
      rec.endedAt = new Date();
      rec.notes = failureNote(r);
      await rec.save();
      return { ok: false, error: r.error, code: r.code };
    }

    rec.providerCallId = r.providerCallId || `cloud-support-${rec._id}`;
    await rec.save();
    return { ok: true, callRecord: rec };
  }

  async status() {
    return {
      provider: 'cloud',
      testMode: false,
      online: this._ready,
      label: `Cloud Calling · ${this._cfg.provider}`,
      detail: this._ready
        ? `${this._cfg.provider} · caller ID ${this._cfg.callerId} · calls dial the customer first, then bridge to the owning agent`
        : 'Set PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN and CLOUD_CALL_CALLER_ID.',
      sipOutboundEnabled: this._ready,
      ivrEnabled: false,
      supportCallEnabled: this._ready,
    };
  }

  // ── manual / quick "Call this lead" — customer rings first; once they
  // answer, Plivo hits our answer_url which bridges to the owning agent.
  // `agent` still drives CRM-side state (Ringing/OnCall/Wrapup) and
  // attribution; `agentPhone` is accepted for backward compatibility with
  // callers but no longer used — the provider no longer dials the agent's
  // own number.
  async placeCall({ agent, agentPhone, phone, contactName, callLead, campaign, callerId }) {
    const CallRecord = mongoose.model('CallRecord');

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
      callerId: callerId || this._cfg.callerId || undefined,
    }).save();

    const r = await this._placeProviderCall({
      customerNumber: last10(phone),
      callerId: rec.callerId,
      crmCallId: String(rec._id),
    });

    if (!r.ok) {
      rec.status = 'failed';
      rec.endedAt = new Date();
      rec.notes = failureNote(r);
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
  // Not implemented for Plivo yet — needs a Live Call Control adapter.
  // Surface that cleanly rather than pretending it worked.
  async transfer({ callRecord }) {
    return {
      ok: false,
      code: 'unsupported',
      error: 'In-call transfer is not supported on the Plivo provider yet.',
      callRecord,
    };
  }

  async hangup({ callRecord, disposition, notes, actorName }) {
    if (disposition) callRecord.disposition = disposition;
    if (notes != null) callRecord.notes = notes;

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
