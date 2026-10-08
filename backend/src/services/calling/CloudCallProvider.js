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
  reserveAgent,
  releaseAgent,
  agentsOnLiveCalls,
  reapStaleAgentReservations,
} = require('./callingShared');
const { NON_SALES_ROLES } = require('../../config/roles');

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

  // ── Instant Lead Pool predictive dial ──────────────────────────────────
  // Unlike dialNext, this dials the CUSTOMER ONLY — no agent leg, no
  // CallRecord.agent set. Whichever agent has been free the longest gets
  // claimed the instant the customer actually answers (plivoAnswer.js's
  // customer-leg handler, via claimLeadPoolAgent) instead of being picked
  // up front and left ringing in parallel — the whole point of the pool
  // being "dial up to 10 lines at once" independent of exactly how many
  // agents happen to be free right now.
  async dialLeadPoolNext(campaign) {
    const CallLead = mongoose.model('CallLead');
    const CallRecord = mongoose.model('CallRecord');

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
      { $set: { status: 'Dialing', lastAttemptAt: new Date() }, $inc: { attempts: 1 } },
      { sort: { attempts: 1, created: 1 }, new: true }
    );
    if (!lead) return { ok: false, error: 'No leads waiting in this campaign.' };

    const now = new Date();
    const rec = await new CallRecord({
      campaign: campaign._id,
      callLead: lead._id,
      contactName: lead.name,
      phone: lead.phone,
      direction: 'Outbound',
      status: 'dialing',
      phaseAt: now,
      queuedAt: now,
      provider: 'cloud',
      isMock: false,
      callerId: campaign.callerId || this._cfg.callerId || undefined,
      team: campaign.team,
      notes: 'Instant Lead Pool — agent assigned on answer',
    }).save();

    const r = await this._placeProviderCall({
      customerNumber: last10(lead.phone),
      callerId: rec.callerId,
      crmCallId: String(rec._id),
    });

    if (!r.ok) {
      rec.status = 'failed';
      rec.endedAt = new Date();
      rec.notes = failureNote(r);
      await rec.save();
      await CallLead.updateOne(
        { _id: lead._id },
        { $set: { status: lead.attempts >= maxAttempts ? 'Failed' : 'Queued' } }
      );
      return { ok: false, error: r.error };
    }

    rec.providerCallId = r.providerCallId || `cloud-${rec._id}`;
    await rec.save();
    return { ok: true, callRecord: rec };
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
    if (callRecord.status === 'completed' && (!callRecord.recording || callRecord.recording.status !== 'available')) {
      await this.syncRecording(callRecord);
    }
    const rec = callRecord.recording || {};
    return {
      status: rec.status || 'unavailable',
      durationSec: rec.durationSec || 0,
      readyAt: rec.readyAt || null,
      url: rec.url || null,
      streamUrl: null,
    };
  }

  // Pull-based fallback/primary path for linking a Conference recording —
  // Plivo's own `recordingCallbackUrl` push callback (see plivoAnswer.js's
  // conferenceXml) never actually reached this server for any real call
  // tested (confirmed directly against Plivo's Recording API: the
  // recordings exist there, correct duration and all, our CallRecord just
  // never heard about it). Plivo's Recording API supports an exact
  // `conference_name` filter, and every conference is named `call-<id>`
  // (see plivoAnswer.js's roomName()), so one targeted lookup per call is
  // enough — no need to guess at call_uuid, which for a conference
  // recording is Plivo's own conference_uuid, not either leg's call_uuid.
  async syncRecording(callRecord) {
    if (!this._ready) return false;
    const p = this._cfg.plivo;
    const conferenceName = `call-${callRecord._id}`;
    const r = await this._fetchJson(
      `${p.apiBase}/v1/Account/${p.authId}/Recording/?conference_name=${encodeURIComponent(conferenceName)}`,
      { method: 'GET', headers: { Authorization: `Basic ${Buffer.from(`${p.authId}:${p.authToken}`).toString('base64')}`, Accept: 'application/json' } }
    );
    const found = r.ok && Array.isArray(r.json?.objects) ? r.json.objects[0] : null;
    if (!found || !found.recording_url) return false;

    const CallRecord = mongoose.model('CallRecord');
    await CallRecord.updateOne(
      { _id: callRecord._id },
      {
        $set: {
          'recording.status': 'available',
          'recording.url': found.recording_url,
          'recording.durationSec': Math.round(Number(found.recording_duration_ms) / 1000) || 0,
          'recording.readyAt': new Date(),
        },
      }
    );
    callRecord.recording = {
      status: 'available',
      url: found.recording_url,
      durationSec: Math.round(Number(found.recording_duration_ms) / 1000) || 0,
      readyAt: new Date(),
    };
    return true;
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

    // 1b. Orphaned "connected" calls: the provider's hangup webhook can
    // fail to arrive (network blip, delivery failure) — without this, one
    // missed webhook leaves that agent's live-call slot permanently
    // occupied, so GET /calling/agent/active keeps showing that same old
    // call forever and masks every real call after it. A genuine call
    // lasting this long is vanishingly rare, so treat anything still
    // "connected"/"onhold" this stale as orphaned, not still in progress.
    const staleConnectedBefore = new Date(now - 3 * 60 * 60 * 1000); // 3h
    const staleConnected = await CallRecord.find({
      provider: 'cloud',
      status: { $in: ['connected', 'onhold'] },
      phaseAt: { $lte: staleConnectedBefore },
    })
      .limit(50)
      .exec();
    for (const rec of staleConnected) {
      rec.status = 'completed';
      rec.endedAt = rec.endedAt || new Date();
      rec.phaseAt = new Date();
      rec.notes = rec.notes ? `${rec.notes} — auto-closed: no hangup webhook received.` : 'Auto-closed: no hangup webhook received.';
      await rec.save();
      if (rec.callLead) {
        await CallLead.updateOne(
          { _id: rec.callLead, status: { $nin: ['Completed', 'Callback', 'DNC'] } },
          { $set: { status: 'Completed' } }
        );
      }
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

    // 2b. Instant Lead Pool scheduled break (Paused) → Available once its
    // fixed duration passes (see leadPool.js's breakStart, config/
    // shiftSchedule.js) — the agent never has to remember to toggle back on.
    const br = await AgentCallState.updateMany(
      { status: 'Paused', pausedUntil: { $lte: new Date(now) } },
      { $set: { status: 'Available', since: new Date() }, $unset: { pausedUntil: '', breakKey: '' } }
    );
    advanced += br.modifiedCount || 0;

    // 2c. Free agents still flagged Ringing/OnCall for a call that is
    // already over — a reservation whose dial threw, or a hangup webhook
    // that never arrived. Without this they drop out of the rotation and
    // the dialer silently stops calling them for the rest of the shift.
    advanced += await reapStaleAgentReservations();

    // 3. Auto-dial Available agents on Active auto-dial campaigns.
    const campaigns = await CallCampaign.find({
      removed: false,
      status: 'Active',
      autoDial: { $ne: false },
    })
      .limit(25)
      .exec();

    for (const camp of campaigns) {
      if (!withinCallingHours(camp)) continue;

      if (camp.isLeadPool) {
        // One customer-only line dialing per free agent, never more — e.g.
        // 1 agent available means exactly 1 line goes out; the moment that
        // call ends and the agent is Available again, the next lead dials.
        // (Previously this over-dialed up to 10 concurrent lines regardless
        // of agent count — fine with a large pool, but with 1-2 agents it
        // meant several customers answering a call nobody could take.) The
        // agent gets picked only once someone actually answers (see
        // dialLeadPoolNext / plivoAnswer.js's claimLeadPoolAgent), so this
        // still self-corrects for no-answers: an unanswered line never ties
        // up an agent's slot, only a truly in-flight (dialing/ringing) one does.
        const poolStates = await AgentCallState.find({ campaign: camp._id, status: 'Available' })
          .select('agent')
          .lean();
        if (!poolStates.length) continue;
        // An agent whose presence row says Available but who CallRecord
        // shows mid-call (a manual dial, an inbound transfer, a missed
        // hangup webhook) is not really free — don't over-dial on them.
        const poolBusy = await agentsOnLiveCalls(poolStates.map((s) => s.agent));
        const availableAgents = poolStates.filter((s) => !poolBusy.has(String(s.agent))).length;
        if (availableAgents === 0) continue;
        // Only the UNANSWERED lines count against the budget here: a
        // lead-pool call that connected has already claimed its agent (see
        // claimLeadPoolAgent), so that agent has dropped out of the
        // Available count above and must not be charged for twice.
        const inFlight = await CallRecord.countDocuments({
          campaign: camp._id,
          removed: false,
          status: { $in: ['dialing', 'ringing'] },
        });
        let budget = availableAgents - inFlight;
        while (budget > 0) {
          const r = await this.dialLeadPoolNext(camp);
          if (!r.ok) break;
          advanced++;
          budget--;
          touched.add(String(camp._id));
        }
        continue;
      }

      if (!camp.agents || !camp.agents.length) continue;

      // ── progressive dialing: one live line per agent, claimed atomically ──
      //
      // Each pass reserves a single Available agent (longest idle first),
      // dials exactly one lead for them, and repeats until nobody is free.
      // When every agent is busy, reserveAgent returns null and NOTHING is
      // dialled — a customer is only ever called once there is a person
      // ready to talk to them, and an agent's next call only starts after
      // their current one has ended and their wrapup has elapsed.
      //
      // Note this deliberately ignores camp.dialRatio. Over-dialling more
      // lines than free agents (predictive dialing) is only safe when the
      // extra lines carry NO agent and claim one on answer, the way the
      // Instant Lead Pool branch above does — pinning a second line to an
      // already-reserved agent just means two customers answering for one
      // person, which is what the ratio used to cause here. Adding real
      // predictive pacing back means giving this path the lead pool's
      // claim-on-answer handling plus an abandoned-call rate cap, not
      // multiplying the reservation count.
      const busy = await agentsOnLiveCalls(camp.agents);
      const attempted = new Set();

      for (;;) {
        // Agents still worth offering this campaign's next lead to: never
        // one we already dialled this pass (that would re-dial an agent we
        // just released), never one CallRecord says is mid-call.
        const pool = camp.agents.filter(
          (id) => !attempted.has(String(id)) && !busy.has(String(id))
        );
        if (!pool.length) break;

        const claimed = await reserveAgent({ agentIds: pool, campaignId: camp._id });
        if (!claimed) break; // every agent busy → no line goes out

        attempted.add(String(claimed.agent));

        const admin = await Admin.findById(claimed.agent)
          .select('name surname phone mobile contactNumber role')
          .lean();
        // Auto-Dialer is Sales-only — campaigns.js already keeps non-Sales
        // agents out of camp.agents, this is just a belt-and-braces check
        // against anything saved before that guard existed.
        if (!admin || NON_SALES_ROLES.includes(admin.role)) {
          await releaseAgent(claimed.agent);
          continue;
        }

        const r = await this.dialNext({ campaign: camp, agent: admin });
        if (r.ok) {
          advanced++;
          touched.add(String(camp._id));
          continue;
        }

        // The dial never happened, so this agent is still free — give them
        // straight back rather than leaving them reserved until the reaper.
        await releaseAgent(claimed.agent);
        if (/No leads waiting/.test(r.error || '')) break; // campaign drained
      }
    }

    for (const cid of touched) await recountCampaign(cid);
    return { advanced };
  }
}

module.exports = CloudCallProvider;
