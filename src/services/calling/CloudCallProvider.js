const mongoose = require('mongoose');
const CallingProvider = require('./CallingProvider');

// CRM-side provider for CALLING_PROVIDER=cloud.
//
// Talks to a hosted click-to-call API (default: Tata Tele Business Services
// "Smartflo"). The provider's platform dials the AGENT's phone first, then
// the CUSTOMER, and bridges the two — so no VPS / Asterisk / SIP trunk is
// needed on our side. Real call state (answered / ended / recording URL)
// arrives on POST /api/cloud-call/webhook, which the provider dashboard is
// configured to hit.
//
//   dialNext / placeCall  → HTTPS POST to the provider's click-to-call API
//   answered / hangup / recording → /api/cloud-call/webhook
//   hold / mute / transfer → not exposed by click-to-call APIs → soft "no"
//
// Per-provider request shape lives in ADAPTERS below; adding Exotel/Twilio/…
// later is a new entry there, nothing else changes.

const digitsOnly = (s) => String(s || '').replace(/[^\d]/g, '');
const last10 = (s) => {
  const d = digitsOnly(s);
  return d.length > 10 ? d.slice(-10) : d;
};

// ── provider adapters ─────────────────────────────────────────────────
// buildClickToCall(cfg, { agentNumber, customerNumber, callerId, crmCallId })
//   → { url, method, headers, body }
// parseClickToCall(json, httpOk) → { ok, providerCallId?, error? }
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
        'StatusCallback': '', // set in dashboard instead
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
    return !!(this._cfg.apiToken && this._cfg.callerId);
  }

  async _clickToCall({ agentNumber, customerNumber, callerId, crmCallId }) {
    if (!this._ready) {
      return { ok: false, error: 'Cloud calling not configured (CLOUD_CALL_API_TOKEN / CLOUD_CALL_CALLER_ID).', code: 'not_configured' };
    }
    const spec = this._adapter.buildClickToCall(this._cfg, {
      agentNumber,
      customerNumber,
      callerId: callerId || this._cfg.callerId,
      crmCallId,
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this._cfg.timeoutMs || 8000);
    try {
      const res = await fetch(spec.url, {
        method: spec.method,
        headers: spec.headers,
        body: spec.rawBody ? spec.body : JSON.stringify(spec.body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch (e) {
        json = { raw: text };
      }
      const parsed = this._adapter.parseClickToCall(json, res.ok);
      return { ...parsed, httpStatus: res.status, providerRaw: json };
    } catch (err) {
      return { ok: false, error: `Cloud calling provider unreachable: ${err.message}`, code: 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  async status() {
    return {
      provider: 'cloud',
      testMode: false,
      online: this._ready,
      label: `Cloud Calling · ${this._cfg.provider}`,
      detail: this._ready
        ? `${this._cfg.provider} · caller ID ${this._cfg.callerId} · calls bridge on the provider (agent phone rings first)`
        : 'Set CLOUD_CALL_API_TOKEN and CLOUD_CALL_CALLER_ID (and CLOUD_CALL_PROVIDER / API_BASE).',
      sipOutboundEnabled: this._ready,
    };
  }

  // ── manual / quick "Call this lead" — agent phone ⇄ customer, bridged ──
  // Used by callingController/manualDial.js when this provider is active.
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
      return { ok: false, error: r.error, code: r.code };
    }

    rec.providerCallId = r.providerCallId || `cloud-${rec._id}`;
    await rec.save();
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

  async dialNext({ campaign, agent }) {
    const CallLead = mongoose.model('CallLead');

    const lead = await CallLead.findOneAndUpdate(
      { campaign: campaign._id, removed: false, status: { $in: ['New', 'Queued'] } },
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
      await CallLead.updateOne({ _id: lead._id }, { $set: { status: 'Failed' } });
      return r;
    }
    r.callRecord.team = campaign.team;
    r.callRecord.callerId = campaign.callerId || this._cfg.callerId;
    await r.callRecord.save();
    return r;
  }

  async answer(callRecord) {
    return { ok: true, callRecord };
  }

  // click-to-call APIs don't expose in-call control — report it cleanly so
  // the UI can disable those buttons rather than showing a hard error.
  async hold({ callRecord }) {
    return { ok: false, error: 'Hold is not available on the cloud calling provider.', code: 'unsupported', callRecord };
  }
  async mute({ callRecord }) {
    return { ok: false, error: 'Mute is not available on the cloud calling provider.', code: 'unsupported', callRecord };
  }
  async transfer({ callRecord }) {
    return { ok: false, error: 'Transfer is not available on the cloud calling provider.', code: 'unsupported', callRecord };
  }

  async hangup({ callRecord, disposition, notes }) {
    // The provider ends the call when either party hangs up; the webhook
    // finalises duration/recording. Mark ended optimistically.
    if (disposition) callRecord.disposition = disposition;
    if (notes != null) callRecord.notes = notes;
    if (!['completed', 'transferred', 'cancelled', 'failed'].includes(callRecord.status)) {
      callRecord.status = 'completed';
      callRecord.endedAt = callRecord.endedAt || new Date();
    }
    await callRecord.save();
    return { ok: true, callRecord };
  }

  async getRecording(callRecord) {
    const rec = callRecord.recording || {};
    return {
      status: rec.status || 'unavailable',
      durationSec: rec.durationSec || 0,
      readyAt: rec.readyAt || null,
      // The provider returns a direct (token-bearing) URL on the webhook.
      url: rec.url || null,
      streamUrl: rec.url ? null : null,
    };
  }

  async tick() {
    return { advanced: 0 };
  }
}

module.exports = CloudCallProvider;
