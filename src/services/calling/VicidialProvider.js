const CallingProvider = require('./CallingProvider');

// Production provider — a documented STUB. When a VICIdial/Asterisk server
// exists, fill each method with the matching API call. Nothing here is
// wired yet; with CALLING_PROVIDER=vicidial and missing config every method
// returns a clean "not configured" shape so the CRM keeps working.
//
// VICIdial surfaces (all under this.config.vicidial.baseUrl):
//   • non_agent_api.php  — admin: add_lead, update_lead, campaign control,
//                          recording_lookup, agent_status …
//   • agc/api.php        — agent: external_dial, external_hangup,
//                          external_pause, transfer_conference, …
// Auth: api user/pass (this.config.vicidial.apiUser / apiPass), never sent
// to the frontend. SIP creds (this.config.sip.*) are Asterisk-side only.

class VicidialProvider extends CallingProvider {
  get name() {
    return 'vicidial';
  }

  get _configured() {
    const v = this.config.vicidial;
    return !!(v.baseUrl && v.apiUser && v.apiPass);
  }

  _notConfigured() {
    return {
      ok: false,
      error:
        'VICIdial is not configured. Set VICIDIAL_URL, VICIDIAL_API_USER, VICIDIAL_API_PASS (and SIP_* on the Asterisk box), then redeploy.',
    };
  }

  async status() {
    return {
      provider: 'vicidial',
      testMode: false,
      online: this._configured, // a real impl would ping non_agent_api.php version
      label: 'VICIdial',
      detail: this._configured
        ? `Configured for ${this.config.vicidial.baseUrl}`
        : 'Set VICIDIAL_* environment variables to connect.',
    };
  }

  // TODO(vicidial): non_agent_api.php?function=<...>
  async startCampaign() {
    return this._configured ? { ok: false, error: 'startCampaign not implemented yet.' } : this._notConfigured();
  }
  async pauseCampaign() {
    return this._configured ? { ok: false, error: 'pauseCampaign not implemented yet.' } : this._notConfigured();
  }
  async stopCampaign() {
    return this._configured ? { ok: false, error: 'stopCampaign not implemented yet.' } : this._notConfigured();
  }
  // agc/api.php?function=external_dial
  async dialNext() {
    return this._configured ? { ok: false, error: 'dialNext not implemented yet.' } : this._notConfigured();
  }
  async answer() {
    return this._notConfigured();
  }
  // agc/api.php?function=external_hangup
  async hangup() {
    return this._notConfigured();
  }
  async hold() {
    return this._notConfigured();
  }
  async mute() {
    return this._notConfigured();
  }
  // agc/api.php?function=transfer_conference
  async transfer() {
    return this._notConfigured();
  }
  // non_agent_api.php?function=recording_lookup
  async getRecording() {
    return { status: 'unavailable', url: null, durationSec: 0, detail: 'VICIdial not connected.' };
  }
  async tick() {
    return { advanced: 0 }; // real telephony is event-driven, not polled here
  }
}

module.exports = VicidialProvider;
