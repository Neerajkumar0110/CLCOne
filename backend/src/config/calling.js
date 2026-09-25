// Calling / call-center configuration. NOTHING provider-specific is
// hardcoded — the provider and every credential come from the environment.
//
//   CALLING_PROVIDER=mock  → simulation, no server (default)
//   CALLING_PROVIDER=cloud → Plivo (see cloud.plivo below)

const PROVIDER = (process.env.CALLING_PROVIDER || 'mock').toLowerCase();

const config = {
  provider: PROVIDER,
  isMock: PROVIDER === 'mock' || PROVIDER === '' || PROVIDER == null,

  // ── Cloud calling API (CALLING_PROVIDER=cloud) ──────────────────────
  // Plivo is the sole target. Call events + recording URL come back on
  // /api/cloud-call/webhook; the answer-time agent bridge is served by
  // /api/cloud-call/plivo-answer (see CloudCallProvider.js PLIVO_ADAPTER
  // and controllers/.../callingController/plivoAnswer.js).
  cloud: {
    provider: (process.env.CLOUD_CALL_PROVIDER || 'plivo').toLowerCase(),
    apiBase: (process.env.CLOUD_CALL_API_BASE || 'https://api.plivo.com').replace(/\/+$/, ''),
    callerId: process.env.CLOUD_CALL_CALLER_ID || '', // default DID shown to the customer
    // Every DID registered on the account, for multi-DID validation. Leave
    // blank to skip validation entirely.
    callerIds: String(process.env.CLOUD_CALL_CALLER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    region: process.env.CLOUD_CALL_REGION || '',
    timeoutMs: Number(process.env.CLOUD_CALL_TIMEOUT_MS || 8000),
    webhookSecret: process.env.CLOUD_CALL_WEBHOOK_SECRET || '',

    // Plivo has no fixed "destination configured on the provider's portal"
    // — call control is entirely ours, via Answer/Hangup XML this backend
    // serves. See CloudCallProvider.js PLIVO_ADAPTER and
    // controllers/.../callingController/plivoAnswer.js.
    plivo: {
      authId: process.env.PLIVO_AUTH_ID || '',
      authToken: process.env.PLIVO_AUTH_TOKEN || '',
      apiBase: (process.env.PLIVO_API_BASE || 'https://api.plivo.com').replace(/\/+$/, ''),
      // Public URL of THIS backend — used to build the answer_url/hangup_url
      // Plivo calls back on for every outbound call.
      publicBaseUrl: (process.env.PLIVO_PUBLIC_BASE_URL || 'https://clcone.careerlabconsulting.com').replace(/\/+$/, ''),
      // Local numbers are stored/passed around as bare 10-digit strings
      // (see last10() in callingShared.js); Plivo needs the country code.
      countryCode: process.env.PLIVO_DEFAULT_COUNTRY_CODE || '91',
    },
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
    cloud: 'Cloud Calling API',
  };
  const cloudLabels = { plivo: 'Plivo' };
  const cloudReady = !!(config.cloud.plivo.authId && config.cloud.plivo.authToken && config.cloud.callerId);
  return {
    provider: config.provider,
    testMode: config.isMock,
    label:
      config.provider === 'cloud'
        ? `Cloud Calling · ${cloudLabels[config.cloud.provider] || config.cloud.provider}`
        : labels[config.provider] || config.provider,
    cloudConfigured: cloudReady,
    callerIds: config.cloud.callerIds,
    supportCallConfigured: cloudReady,
  };
}

module.exports = { callingConfig: config, publicCallingConfig: publicConfig };
