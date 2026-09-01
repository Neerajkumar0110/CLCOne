// Abstract calling provider. Every concrete provider (Mock, VICIdial)
// implements this surface, so the calling controllers never care which one
// is active — they just call `getProvider()` from ./index.
//
//   CRM  ──►  CallingProvider  ──►  { MockCallingProvider | VICIdialProvider }
//                                        VICIdial ──► Asterisk ──► SIP ──► Customer
//
// All methods are async and return plain data (never throw for expected
// "not connected" states — return a shape the API can pass through).

class CallingProvider {
  constructor(config) {
    this.config = config;
  }

  get name() {
    return 'base';
  }

  // { provider, testMode, online, label, detail? }
  async status() {
    throw new Error('not implemented');
  }

  // Campaign lifecycle. Returns { ok, status } / { ok:false, error }.
  async startCampaign(/* campaign */) {
    throw new Error('not implemented');
  }
  async pauseCampaign(/* campaign */) {
    throw new Error('not implemented');
  }
  async stopCampaign(/* campaign */) {
    throw new Error('not implemented');
  }

  // Place the next dial for one agent on a campaign. Returns { ok, callRecord }.
  async dialNext(/* { campaign, agent } */) {
    throw new Error('not implemented');
  }

  // In-call agent actions. Each returns { ok, callRecord } / { ok:false, error }.
  async answer(/* callRecord */) {
    throw new Error('not implemented');
  }
  async hangup(/* { callRecord, disposition, notes } */) {
    throw new Error('not implemented');
  }
  async hold(/* { callRecord, on } */) {
    throw new Error('not implemented');
  }
  async mute(/* { callRecord, on } */) {
    throw new Error('not implemented');
  }
  async transfer(/* { callRecord, target, toAgent } */) {
    throw new Error('not implemented');
  }

  // Recording lookup — NEVER returns a real production URL in mock mode.
  async getRecording(/* callRecord */) {
    throw new Error('not implemented');
  }

  // Advance any time-based state (mock simulation). No-op for real providers.
  async tick() {
    return { advanced: 0 };
  }
}

module.exports = CallingProvider;
