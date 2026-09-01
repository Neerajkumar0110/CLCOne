const mongoose = require('mongoose');
const CallingProvider = require('./CallingProvider');
const { buildHeaders } = require('./httpSign');

// CRM-side provider for CALLING_PROVIDER=telephony. Talks ONLY to the VPS
// Telephony Integration Service over HTTPS (signed). It never sees AMI,
// MySQL, SIP creds or Asterisk internals — the VPS abstracts all of that.
//
//   dialNext/hangup/hold/mute/transfer  → HTTPS POST to the VPS
//   real call-state changes             → arrive via /api/telephony/* webhook
//   tick()                              → no-op (event-driven, not polled)

class TelephonyProvider extends CallingProvider {
  get name() {
    return 'telephony';
  }

  get _ready() {
    const t = this.config.telephony;
    return !!(t.apiUrl && t.apiKey && t.hmacSecret);
  }

  async _call(method, path, body) {
    if (!this._ready) {
      return { ok: false, error: 'Telephony service is not configured (TELEPHONY_API_URL / KEY / HMAC_SECRET).', code: 'not_configured' };
    }
    const t = this.config.telephony;
    const url = t.apiUrl.replace(/\/+$/, '') + path;
    const { headers, rawBody } = buildHeaders({ apiKey: t.apiKey, secret: t.hmacSecret, body: body || {} });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), t.timeoutMs || 8000);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : rawBody,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch (e) {
        json = { ok: false, error: `Bad response from telephony service (${res.status}).` };
      }
      if (!res.ok && json.ok === undefined) json.ok = false;
      return json;
    } catch (err) {
      return { ok: false, error: `Telephony service unreachable: ${err.message}`, code: 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  async status() {
    const r = await this._call('GET', '/status');
    return {
      provider: 'telephony',
      testMode: false,
      online: !!r.ok && !!r.online,
      label: 'VICIdial (Asterisk)',
      detail: !this._ready
        ? 'Set TELEPHONY_API_URL / TELEPHONY_API_KEY / TELEPHONY_HMAC_SECRET.'
        : r.ok
        ? `Asterisk ${r.asterisk?.version || '?'} · SIP outbound ${r.sipOutboundEnabled ? 'ENABLED' : 'disabled (no provider yet)'}`
        : r.error || 'Telephony service not reachable.',
      sipOutboundEnabled: !!r.sipOutboundEnabled,
      raw: r.ok ? { asterisk: r.asterisk, vicidial: r.vicidial } : undefined,
    };
  }

  async startCampaign(campaign) {
    return this._call('POST', `/campaigns/${campaign._id}/start`, { name: campaign.name, dialRatio: campaign.dialRatio });
  }
  async pauseCampaign(campaign) {
    return this._call('POST', `/campaigns/${campaign._id}/pause`, {});
  }
  async stopCampaign(campaign) {
    return this._call('POST', `/campaigns/${campaign._id}/stop`, {});
  }

  // Originate a call for an agent. The CallRecord is created here in a
  // pending state; real transitions land via webhook.
  async dialNext({ campaign, agent }) {
    const CallLead = mongoose.model('CallLead');
    const CallRecord = mongoose.model('CallRecord');

    const lead = await CallLead.findOneAndUpdate(
      { campaign: campaign._id, removed: false, status: { $in: ['New', 'Queued'] } },
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
      status: 'queued',
      phaseAt: now,
      queuedAt: now,
      provider: 'telephony',
      isMock: false,
      team: campaign.team,
    }).save();

    const r = await this._call('POST', '/originate', {
      crmCallId: String(rec._id),
      phone: lead.phone,
      callerId: campaign.callerId || '',
      campaignId: String(campaign._id),
      vicidialLeadId: lead.vicidialLeadId || undefined,
      agentId: String(agent._id),
      // The VPS resolves this to the agent's SIP extension / VICIdial user.
      agentRef: agent.email || String(agent._id),
    });

    if (!r.ok) {
      rec.status = 'failed';
      rec.endedAt = new Date();
      rec.notes = r.error;
      await rec.save();
      await CallLead.updateOne({ _id: lead._id }, { $set: { status: 'Failed' } });
      return { ok: false, error: r.error, code: r.code };
    }

    rec.status = 'dialing';
    rec.phaseAt = new Date();
    rec.providerCallId = r.providerCallId || r.uniqueid || undefined;
    rec.asteriskUniqueId = r.uniqueid || undefined;
    rec.asteriskLinkedId = r.linkedid || undefined;
    rec.vicidialCallId = r.vicidialCallId || undefined;
    await rec.save();

    return { ok: true, callRecord: rec };
  }

  async answer(callRecord) {
    // Answer is telephony-side (the customer picks up) — nothing to push.
    return { ok: true, callRecord };
  }

  async hold({ callRecord, on }) {
    const r = await this._call('POST', `/call/${callRecord.providerCallId || callRecord._id}/hold`, { on: !!on });
    if (r.ok) {
      callRecord.onHold = !!on;
      callRecord.status = on ? 'onhold' : 'connected';
      await callRecord.save();
    }
    return r.ok ? { ok: true, callRecord } : r;
  }

  async mute({ callRecord, on }) {
    const r = await this._call('POST', `/call/${callRecord.providerCallId || callRecord._id}/mute`, { on: !!on });
    if (r.ok) {
      callRecord.muted = !!on;
      await callRecord.save();
    }
    return r.ok ? { ok: true, callRecord } : r;
  }

  async hangup({ callRecord, disposition, notes }) {
    const r = await this._call('POST', `/call/${callRecord.providerCallId || callRecord._id}/hangup`, {
      disposition: disposition || undefined,
      notes: notes || undefined,
    });
    // The webhook finalises status/duration/recording; optimistically mark ended.
    if (disposition) callRecord.disposition = disposition;
    if (notes != null) callRecord.notes = notes;
    if (!['completed', 'transferred', 'cancelled'].includes(callRecord.status)) {
      callRecord.status = 'completed';
      callRecord.endedAt = callRecord.endedAt || new Date();
    }
    await callRecord.save();
    return r.ok ? { ok: true, callRecord } : { ok: true, callRecord, warning: r.error };
  }

  async transfer({ callRecord, target, toAgent }) {
    const r = await this._call('POST', `/call/${callRecord.providerCallId || callRecord._id}/transfer`, {
      target: target || undefined,
      toAgentId: toAgent ? String(toAgent._id) : undefined,
      toAgentRef: toAgent ? toAgent.email || String(toAgent._id) : undefined,
      mode: 'blind',
    });
    if (!r.ok) return r;
    callRecord.status = 'transferred';
    callRecord.transferStatus = 'requested';
    callRecord.transferredTo = target || (toAgent ? 'Agent' : 'Queue');
    if (toAgent) callRecord.transferredToAgent = toAgent._id;
    callRecord.endedAt = new Date();
    await callRecord.save();
    return { ok: true, callRecord };
  }

  // The CRM never serves the raw file — it proxies /api/calling/recordings/:id/stream
  // which pulls (authorised, short-lived) from the VPS.
  async getRecording(callRecord) {
    const rec = callRecord.recording || {};
    return {
      status: rec.status || 'unavailable',
      durationSec: rec.durationSec || 0,
      readyAt: rec.readyAt || null,
      url: null,
      streamUrl: rec.status === 'available' ? `/api/calling/recordings/${callRecord._id}/stream` : null,
    };
  }

  // Call state is event-driven (webhooks), so there's nothing to advance.
  // We piggy-back on tick() to drain any failed/soft-missed webhook events
  // (the dead-letter queue) — cheap, bounded, and keeps sync eventually
  // consistent even if the CRM was briefly down when an event arrived.
  async tick() {
    try {
      const { replayFailed } = require('../../controllers/appControllers/telephonyController');
      const r = await replayFailed(15);
      return { advanced: r.fixed || 0 };
    } catch (e) {
      return { advanced: 0 };
    }
  }
}

module.exports = TelephonyProvider;
