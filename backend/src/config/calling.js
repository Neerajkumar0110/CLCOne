// Calling / call-center configuration. NOTHING telephony-specific is
// hardcoded — the provider and every credential come from the environment.
//
//   CALLING_PROVIDER=mock      → simulation, no server (default)
//   CALLING_PROVIDER=telephony → talk to the VPS Telephony Integration
//                                Service over HTTPS (VICIdial + Asterisk)
//   CALLING_PROVIDER=vicidial  → (legacy stub, kept for reference)

const PROVIDER = (process.env.CALLING_PROVIDER || 'mock').toLowerCase();

const config = {
  provider: PROVIDER,
  isMock: PROVIDER === 'mock' || PROVIDER === '' || PROVIDER == null,

  // ── VPS Telephony Integration Service (CRM → VPS direction) ──────────
  // The CRM backend calls THIS; the VPS calls back via the /api/telephony
  // webhook. No SIP/AMI/DB detail ever reaches the CRM.
  telephony: {
    apiUrl: process.env.TELEPHONY_API_URL || '', // https://telephony.example.com
    apiKey: process.env.TELEPHONY_API_KEY || '', // shared key, header x-telephony-key
    hmacSecret: process.env.TELEPHONY_HMAC_SECRET || '', // request signing
    timeoutMs: Number(process.env.TELEPHONY_TIMEOUT_MS || 8000),
  },

  // ── inbound webhook (VPS → CRM direction) ───────────────────────────
  webhook: {
    apiKey: process.env.TELEPHONY_WEBHOOK_KEY || '',
    hmacSecret: process.env.TELEPHONY_WEBHOOK_HMAC_SECRET || '',
    // reject events whose timestamp is older/newer than this (replay guard)
    toleranceSec: Number(process.env.TELEPHONY_WEBHOOK_TOLERANCE_SEC || 300),
  },

  // ── Cloud calling API (CALLING_PROVIDER=cloud) ──────────────────────
  // Tata Tele Business Services is the sole target. Two of their products
  // are wired in:
  //   • Smartflo click_to_call (agent-bridge) — dials the agent's phone,
  //     then the customer, and bridges the two. Drives placeCall/dialNext.
  //   • Click-to-Call Support API (direct-to-customer, multi-DID + async,
  //     optional voice-bot destination) — see cloud.support below.
  // Call events + recording URL for both come back on /api/cloud-call/webhook.
  cloud: {
    provider: (process.env.CLOUD_CALL_PROVIDER || 'tata').toLowerCase(), // tata | edesy | exotel | ozonetel | knowlarity | servetel | twilio
    apiBase: (process.env.CLOUD_CALL_API_BASE || 'https://api-smartflo.tatateleservices.com').replace(/\/+$/, ''),
    accountSid: process.env.CLOUD_CALL_ACCOUNT_SID || '',
    apiKey: process.env.CLOUD_CALL_API_KEY || '',
    apiToken: process.env.CLOUD_CALL_API_TOKEN || '', // Smartflo: the panel "API Token" (Bearer)
    callerId: process.env.CLOUD_CALL_CALLER_ID || '', // default DID shown to the customer
    // Every DID registered on the account, for multi-DID validation (the
    // Support API's `caller_id` rule: "Please provide a valid caller_id."
    // if it's not one of these). Leave blank to skip validation entirely.
    callerIds: String(process.env.CLOUD_CALL_CALLER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    region: process.env.CLOUD_CALL_REGION || '',
    timeoutMs: Number(process.env.CLOUD_CALL_TIMEOUT_MS || 8000),
    webhookSecret: process.env.CLOUD_CALL_WEBHOOK_SECRET || '',

    // ── Tata Business Click-to-Call SUPPORT API ─────────────────────────
    // A separate product from Smartflo above: one HTTP call dials
    // `customer_number` directly (no agent leg) and connects it to whatever
    // destination is configured on the Tata side — an agent queue or a
    // voice bot. See services/calling/CloudCallProvider.js `support` adapter.
    support: {
      apiUrl: process.env.CLOUD_CALL_SUPPORT_API_URL || '', // from the Tata portal/API doc for this product
      apiKey: process.env.CLOUD_CALL_SUPPORT_API_KEY || '', // the `api_key` value
      async: process.env.CLOUD_CALL_SUPPORT_ASYNC !== 'false', // doc default: async:1
    },

    // ── Bi-directional audio streaming (IVR / voice bot) ────────────────
    // Tata's platform opens a WebSocket to us per call and streams
    // mulaw/8000 audio both ways. See services/calling/voiceStream.js.
    voiceStream: {
      enabled: process.env.CLOUD_CALL_VOICE_STREAM_ENABLED === 'true',
      path: process.env.CLOUD_CALL_VOICE_STREAM_PATH || '/api/cloud-call/voice-stream',
      sharedSecret: process.env.CLOUD_CALL_VOICE_STREAM_SECRET || '',
    },

    // ── optional IVR/transfer companion API (provider-specific, blank = off) ──
    // Not part of either Tata product documented so far; kept so an
    // in-call-transfer API can be plugged in later without a redesign.
    voiceBase: (process.env.CLOUD_CALL_VOICE_BASE || '').replace(/\/+$/, ''),
    voiceKey: process.env.CLOUD_CALL_VOICE_KEY || '',
    workspaceId: process.env.CLOUD_CALL_WORKSPACE_ID || '',
    voiceAgentId: process.env.CLOUD_CALL_AGENT_ID || '', // default voice-agent / flow for outbound
  },

  // Legacy stub config (unused unless CALLING_PROVIDER=vicidial).
  vicidial: {
    baseUrl: process.env.VICIDIAL_URL || '',
    apiUser: process.env.VICIDIAL_API_USER || '',
    apiPass: process.env.VICIDIAL_API_PASS || '',
    source: process.env.VICIDIAL_SOURCE || 'crm',
  },
  sip: {
    host: process.env.SIP_HOST || '',
    port: process.env.SIP_PORT || '',
    user: process.env.SIP_USER || '',
    pass: process.env.SIP_PASS || '',
  },

  mock: {
    dialSeconds: 2,
    ringSecondsMin: 3,
    ringSecondsMax: 7,
    maxTalkSeconds: 180,
    wrapupSeconds: 8,
    recordingProcessingSeconds: 10,
    outcomeWeights: {
      connected: 0.55,
      'no-answer': 0.2,
      busy: 0.1,
      failed: 0.08,
      voicemail: 0.07,
    },
  },
};

// A safe, frontend-exposable view — NO secrets.
function publicConfig() {
  const labels = {
    mock: 'Mock / Test Provider',
    telephony: 'VICIdial (Asterisk)',
    vicidial: 'VICIdial (legacy)',
    cloud: 'Cloud Calling API',
  };
  const cloudLabels = { tata: 'Tata Smartflo', exotel: 'Exotel', edesy: 'Edesy Number Masking', ozonetel: 'Ozonetel', knowlarity: 'Knowlarity', servetel: 'Servetel', twilio: 'Twilio' };
  const cloudReady = !!((config.cloud.apiToken || config.cloud.apiKey) && config.cloud.callerId);
  const voiceAgentReady = !!(config.cloud.voiceKey && config.cloud.voiceBase);
  const supportReady = !!(config.cloud.support.apiUrl && config.cloud.support.apiKey);
  return {
    provider: config.provider,
    testMode: config.isMock,
    label:
      config.provider === 'cloud'
        ? `Cloud Calling · ${cloudLabels[config.cloud.provider] || config.cloud.provider}`
        : labels[config.provider] || config.provider,
    telephonyConfigured: !!(config.telephony.apiUrl && config.telephony.apiKey && config.telephony.hmacSecret),
    cloudConfigured: cloudReady,
    callerIds: config.cloud.callerIds,
    // Click-to-Call Support API (direct-to-customer / voice-bot dial).
    supportCallConfigured: supportReady,
    voiceStreamConfigured: !!config.cloud.voiceStream.enabled,
    // IVR menus + in-call transfer need a configured voice companion API.
    ivrConfigured: voiceAgentReady,
  };
}

module.exports = { callingConfig: config, publicCallingConfig: publicConfig };
