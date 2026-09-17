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
// Tata Tele Business Services is the default/primary target going forward.
// Two of their products are wired in side by side:
//   • Smartflo click_to_call (ADAPTERS.tata) — 1:1 bridge: agent phone
//     rings first, then the customer. Kept for reference / other call
//     paths, but placeCall/dialNext no longer use it (see next bullet).
//   • Click-to-Call Support API (this._supportCall / placeSupportCall) —
//     dials the customer FIRST, no agent leg initiated by us, and once the
//     customer answers Tata connects the second leg to whatever
//     destination is configured against that API key on the Tata portal
//     (a fixed queue/number/voice bot — not chosen per call from the CRM).
//     placeCall/dialNext (the "Call this lead" button + the auto-dialer)
//     use this so the customer rings before anything else; CRM-side agent
//     assignment (who a call/lead is attributed to) is unaffected, it just
//     no longer drives which phone Tata rings second. Supports multi-DID
//     (`caller_id`) and async dispatch. Config is independent of
//     CLOUD_CALL_PROVIDER (cloud.support.*).
// Live audio for the voice-bot destination flows over a separate
// WebSocket — see services/calling/voiceStream.js.
//
// ADAPTERS.edesy is kept (not the default; CLOUD_CALL_PROVIDER=tata is) —
// an account already runs on it in at least one deployment and no Tata
// Smartflo Bearer token has been supplied yet to cut that one over. Point
// CLOUD_CALL_PROVIDER at it explicitly if that's still what's configured.
//
// Real call state (answered / ended / recording / DTMF) always arrives on
// POST /api/cloud-call/webhook — the provider dashboard is configured to hit it.
//
// Adding Exotel/Twilio/… later is a new entry in ADAPTERS, nothing else.

const digitsOnly = (s) => String(s || '').replace(/[^\d]/g, '');

// A failed call's `notes` is the only place to see WHY once the response
// popup is gone — include the provider's full raw JSON (not just the
// extracted message), since a generic-sounding error like "Unable to
// process this request" often carries an error code or detail field that
// `parseCall`/`parseClickToCall` didn't specifically look for.
function failureNote(r) {
  const msg = typeof r.error === 'string' ? r.error : JSON.stringify(r.error);
  const raw = r.providerRaw ? ` — provider raw: ${JSON.stringify(r.providerRaw)}` : '';
  const status = r.httpStatus ? ` (HTTP ${r.httpStatus})` : '';
  return `${msg}${status}${raw}`;
}

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
      // async:1 means call_id is always null on this response — Smartflo
      // only assigns it once the call actually happens. ref_id is present
      // immediately AND shows up on the matching /v1/call/records CDR row
      // later, so it's the one usable correlation key end-to-end (verified
      // 2026-09-15 against real calls).
      return ok
        ? { ok: true, providerCallId: json.ref_id || json.call_id || json.callId || json.uuid || undefined }
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
  // the returned call_sid. Kept for accounts already configured on it — see
  // the note above ADAPTERS.
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

// Tata Business Click-to-Call SUPPORT API — a separate, simpler product
// from Smartflo above: no agent leg, `caller_id` is optional (multi-DID),
// and `async: 1` means the HTTP call returns immediately while the call
// itself dials in the background. Kept apart from ADAPTERS because its
// request shape (and config: cloud.support.*) is unrelated to click_to_call.
const SUPPORT_ADAPTER = {
  buildCall(cfg, { customerNumber, callerId, async: asyncFlag }) {
    const body = { api_key: cfg.support.apiKey, customer_number: customerNumber };
    if (callerId) body.caller_id = callerId;
    if (asyncFlag) body.async = 1;
    return {
      url: cfg.support.apiUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    };
  },
  parseCall(json, httpOk) {
    const ok = httpOk && (json.success === true || json.success === 'true' || /success/i.test(json.message || json.status || ''));
    return ok
      ? { ok: true, providerCallId: json.call_id || json.callId || json.uuid || undefined }
      : { ok: false, error: json.message || json.error || 'Provider rejected the support-call request.' };
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

  get _supportReady() {
    return !!(this._cfg.support.apiUrl && this._cfg.support.apiKey);
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
      // 'Connection: close' works around a real hang seen against Tata's
      // Smartflo API: Node's fetch (undici) never resolves the response body
      // on some successful replies from that host — even the AbortController
      // timeout above never fires — while curl against the identical request
      // returns cleanly. Forcing the server to close the connection after
      // responding sidesteps whatever keep-alive/framing quirk causes it.
      // Verified fix 2026-09-15 against the real endpoint.
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

  async _clickToCall({ agentNumber, customerNumber, callerId, crmCallId }) {
    if (!this._ready) {
      return {
        ok: false,
        error: 'Cloud calling not configured (CLOUD_CALL_API_TOKEN or CLOUD_CALL_API_KEY, plus CLOUD_CALL_CALLER_ID).',
        code: 'not_configured',
      };
    }
    if (!this._validCallerId(callerId)) {
      return { ok: false, error: 'Please provide a valid caller_id.', code: 'invalid_caller_id' };
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

  // ── Click-to-Call SUPPORT API — direct-to-customer, no agent leg ──────
  // Used for automated/support outbound dialing (e.g. a campaign whose IVR
  // flow routes to a voice bot) rather than agent-initiated calls.
  async _supportCall({ customerNumber, callerId, crmCallId }) {
    if (!this._supportReady) {
      return {
        ok: false,
        error: 'Support click-to-call not configured (CLOUD_CALL_SUPPORT_API_URL / CLOUD_CALL_SUPPORT_API_KEY).',
        code: 'not_configured',
      };
    }
    if (!this._validCallerId(callerId)) {
      return { ok: false, error: 'Please provide a valid caller_id.', code: 'invalid_caller_id' };
    }
    const spec = SUPPORT_ADAPTER.buildCall(this._cfg, {
      customerNumber,
      callerId,
      async: this._cfg.support.async,
    });
    const r = await this._fetchJson(spec.url, {
      method: spec.method,
      headers: spec.headers,
      body: JSON.stringify(spec.body),
    });
    if (r.error) return { ok: false, error: `Cloud calling provider unreachable: ${r.error}`, code: 'unreachable' };
    const parsed = SUPPORT_ADAPTER.parseCall(r.json, r.ok);
    return { ...parsed, httpStatus: r.status, providerRaw: r.json };
  }

  // "Support call" this lead — dials the customer directly (no agent leg),
  // routed on the Tata side to an agent queue or a voice bot.
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
      notes: 'Click-to-Call Support API',
    }).save();

    const r = await this._supportCall({
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
        ? `${this._cfg.provider} · caller ID ${this._cfg.callerId}` +
          (this._supportReady
            ? ' · calls dial the customer first, then connect to the configured destination'
            : ' · WARNING: Support API not configured (CLOUD_CALL_SUPPORT_API_URL/KEY) — "Call this lead" and the auto-dialer will fail') +
          (this._voiceReady ? ' · IVR + transfer enabled' : '')
        : 'Set CLOUD_CALL_API_TOKEN or CLOUD_CALL_API_KEY, and CLOUD_CALL_CALLER_ID (plus CLOUD_CALL_PROVIDER / API_BASE).',
      sipOutboundEnabled: this._ready,
      ivrEnabled: this._voiceReady,
      supportCallEnabled: this._supportReady,
    };
  }

  // ── manual / quick "Call this lead" — customer rings first, then Tata
  // connects the second leg to the destination fixed on the Support API key
  // (see the file-header comment). `agent` still drives CRM-side state
  // (Ringing/OnCall/Wrapup) and attribution; `agentPhone` is accepted for
  // backward compatibility with callers but no longer used — the provider
  // no longer dials the agent's own number.
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

    const r = await this._supportCall({
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
          'In-call transfer needs a configured voice companion API (set CLOUD_CALL_VOICE_KEY / CLOUD_CALL_VOICE_BASE). Agent-bridge calls cannot be transferred mid-call otherwise.',
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

  // ── CDR sync (Tata Smartflo) ──────────────────────────────────────────
  // Pulls GET /v1/call/records and reconciles it into CallRecord — both
  // UPDATING calls the CRM already knows about (status/duration/recording;
  // the webhook never carries a recording URL, only this CDR endpoint does)
  // and CREATING a CallRecord for any call that shows up in Tata's CDR but
  // wasn't originated through provider.placeCall()/placeSupportCall() (e.g.
  // a call placed via direct API testing, or eventually the Tata dashboard
  // itself) — so "everything that happened on the Tata account" is visible
  // in the CRM, not just "everything the CRM itself triggered". Matched by
  // `ref_id` (== providerCallId, see parseClickToCall above). Agent
  // attribution is by matching the CDR's agent number against every
  // Admin's phone/mobile/contactNumber (last 10 digits) — a call the CRM
  // didn't originate has no `agent` field to fall back on otherwise, and
  // this is what makes it show up correctly in a "my calls" personal view.
  // Called by jobs/callingRecordingSync.js. Tata's API rate-limits
  // aggressively (429 seen after ~2 quick requests in testing 2026-09-15),
  // so this does ONE page fetch per call.
  async syncCdr({ limit = 50 } = {}) {
    if (this._cfg.provider !== 'tata' || !this._ready) return { created: 0, updated: 0 };
    const CallRecord = mongoose.model('CallRecord');
    const CallLead = mongoose.model('CallLead');
    const Admin = mongoose.model('Admin');

    const r = await this._fetchJson(`${this._cfg.apiBase}/v1/call/records?limit=${limit}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this._cfg.apiToken}`, Accept: 'application/json' },
    });
    if (r.error || !r.ok) return { created: 0, updated: 0, error: r.error };
    const results = (r.json && r.json.results) || [];
    if (!results.length) return { created: 0, updated: 0 };

    const admins = await Admin.find({ removed: false })
      .select('name surname phone mobile contactNumber')
      .lean();
    const adminByPhone = new Map();
    for (const a of admins) {
      for (const p of [a.phone, a.mobile, a.contactNumber]) {
        const d = last10(p);
        if (d && !adminByPhone.has(d)) adminByPhone.set(d, a);
      }
    }

    let created = 0;
    let updated = 0;
    for (const row of results) {
      if (!row.ref_id) continue;
      let rec = await CallRecord.findOne({ providerCallId: row.ref_id, removed: false });

      const customerPhone = last10(row.client_number);
      const agentPhoneDigits = last10(row.agent_number || row.answered_agent_number);
      const admin = agentPhoneDigits ? adminByPhone.get(agentPhoneDigits) : null;
      // 'no-answer' (not 'failed') so these bucket correctly under the
      // "Missed / No-Answer" KPI on the Calling dashboard, not "Failed".
      const mappedStatus = row.status === 'answered' ? 'completed' : row.status === 'missed' ? 'no-answer' : undefined;
      const startAt = row.date && row.time ? new Date(`${row.date}T${row.time}`) : undefined;
      const endAt = row.end_stamp ? new Date(String(row.end_stamp).replace(' ', 'T')) : undefined;
      const durationSec = Math.round(row.answered_seconds || row.total_call_duration || row.call_duration || 0);

      if (!rec) {
        const callerLead = customerPhone
          ? await CallLead.findOne({ phoneNormalized: customerPhone, removed: false }).sort({ created: -1 })
          : null;
        rec = new CallRecord({
          campaign: callerLead ? callerLead.campaign : undefined,
          callLead: callerLead ? callerLead._id : undefined,
          agent: admin ? admin._id : undefined,
          agentName: admin ? `${admin.name} ${admin.surname || ''}`.trim() : undefined,
          contactName: (callerLead && callerLead.name) || row.client_number || 'Unknown',
          phone: row.client_number || '',
          direction: row.direction === 'inbound' ? 'Inbound' : 'Outbound',
          status: mappedStatus || 'completed',
          queuedAt: startAt || new Date(),
          phaseAt: endAt || startAt || new Date(),
          answeredAt: row.status === 'answered' ? startAt : undefined,
          endedAt: endAt || startAt || new Date(),
          duration: durationSec,
          provider: 'cloud',
          providerCallId: row.ref_id,
          callerId: row.did_number || row.caller_id_num || undefined,
          isMock: false,
          notes: 'Imported from Tata CDR',
        });
        created++;
      } else {
        let changed = false;
        if (admin && !rec.agent) {
          rec.agent = admin._id;
          rec.agentName = `${admin.name} ${admin.surname || ''}`.trim();
          changed = true;
        }
        if (mappedStatus && rec.status !== 'transferred' && rec.status !== mappedStatus) {
          rec.status = mappedStatus;
          changed = true;
        }
        if (durationSec > (rec.duration || 0)) {
          rec.duration = durationSec;
          changed = true;
        }
        if (endAt && !rec.endedAt) {
          rec.endedAt = endAt;
          changed = true;
        }
        if (changed) updated++;
      }

      if (row.recording_url && rec.recording?.url !== row.recording_url) {
        rec.recording = {
          status: 'available',
          url: row.recording_url,
          durationSec: durationSec || rec.recording?.durationSec || 0,
          readyAt: new Date(),
        };
      }
      rec.providerRaw = { ...(rec.providerRaw || {}), cdr: row };
      await rec.save();
    }
    return { created, updated, total: results.length };
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
