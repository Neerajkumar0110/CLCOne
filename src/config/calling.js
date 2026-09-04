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
  // A hosted click-to-call provider (default target: Tata Tele Business
  // Services "Smartflo"). Their platform dials the agent's phone, then the
  // customer, and bridges the two. Call events + recording URL come back
  // on the /api/cloud-call/webhook endpoint.
  cloud: {
    provider: (process.env.CLOUD_CALL_PROVIDER || 'tata').toLowerCase(), // tata | exotel | ozonetel | knowlarity | servetel | twilio
    apiBase: (process.env.CLOUD_CALL_API_BASE || 'https://api-smartflo.tatateleservices.com').replace(/\/+$/, ''),
    accountSid: process.env.CLOUD_CALL_ACCOUNT_SID || '',
    apiKey: process.env.CLOUD_CALL_API_KEY || '',
    apiToken: process.env.CLOUD_CALL_API_TOKEN || '', // Smartflo: the panel "API Token" (Bearer)
    callerId: process.env.CLOUD_CALL_CALLER_ID || '', // your DID shown to the customer
    region: process.env.CLOUD_CALL_REGION || '',
    timeoutMs: Number(process.env.CLOUD_CALL_TIMEOUT_MS || 8000),
    webhookSecret: process.env.CLOUD_CALL_WEBHOOK_SECRET || '',
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
  const cloudLabels = { tata: 'Tata Smartflo', exotel: 'Exotel', ozonetel: 'Ozonetel', knowlarity: 'Knowlarity', servetel: 'Servetel', twilio: 'Twilio' };
  const cloudReady = !!(config.cloud.apiToken && config.cloud.callerId);
  return {
    provider: config.provider,
    testMode: config.isMock,
    label:
      config.provider === 'cloud'
        ? `Cloud Calling · ${cloudLabels[config.cloud.provider] || config.cloud.provider}`
        : labels[config.provider] || config.provider,
    telephonyConfigured: !!(config.telephony.apiUrl && config.telephony.apiKey && config.telephony.hmacSecret),
    cloudConfigured: cloudReady,
  };
}

module.exports = { callingConfig: config, publicCallingConfig: publicConfig };
