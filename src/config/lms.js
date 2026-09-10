// LMS / Moodle integration configuration. Nothing Moodle- or BBB-specific is
// hardcoded — every URL and secret comes from the environment. Mirrors the
// shape of config/calling.js.
//
//   MOODLE_WS_URL / MOODLE_WS_TOKEN   → CRM → Moodle Web Services (REST)
//   MOODLE_WEBHOOK_HMAC_SECRET        → Moodle (local_crmbridge) → CRM webhook
//   MOODLE_SSO_SECRET                 → CRM-minted login token for local_crmsso
//   BBB_URL / BBB_SECRET             → BigBlueButton (usually set on Moodle,
//                                       held here too for the health check)
//
// Leave MOODLE_WS_URL blank to run "unconfigured": portals render a degraded
// state, the webhook returns 503, sync jobs park instead of erroring.

const clean = (s) => String(s || '').replace(/\/+$/, '');

const config = {
  // ── CRM → Moodle Web Services ──────────────────────────────────────────
  moodle: {
    // Base site URL, e.g. https://learn.example.com  (NOT the /webservice path)
    baseUrl: clean(process.env.MOODLE_WS_URL),
    token: process.env.MOODLE_WS_TOKEN || '',
    // REST endpoint + JSON format are fixed for the whole client.
    restPath: '/webservice/rest/server.php',
    timeoutMs: Number(process.env.MOODLE_WS_TIMEOUT_MS || 12000),
    // read-through cache for list/read calls (seconds)
    cacheTtlSec: Number(process.env.MOODLE_WS_CACHE_TTL_SEC || 30),
    // circuit breaker: after N consecutive failures, fail fast for coolOffMs
    breakerThreshold: Number(process.env.MOODLE_WS_BREAKER_THRESHOLD || 5),
    breakerCoolOffMs: Number(process.env.MOODLE_WS_BREAKER_COOLOFF_MS || 30000),
    retry: {
      attempts: Number(process.env.MOODLE_WS_RETRY_ATTEMPTS || 3),
      baseDelayMs: Number(process.env.MOODLE_WS_RETRY_BASE_MS || 400),
    },
    // Course-shell creation from the CRM (syncService.mirrorCourse):
    //   defaultCategoryId — Moodle course category new shells land in (1 = the
    //                       stock "Miscellaneous"); make a dedicated one and
    //                       set its id here for production.
    //   provisionAuth     — auth plugin for CRM-provisioned accounts. 'manual'
    //                       works everywhere; 'nologin' hard-blocks direct
    //                       login (SSO still works via local_crmsso).
    //   courseShortPrefix — prefix for the generated unique course shortname.
    defaultCategoryId: Number(process.env.MOODLE_DEFAULT_CATEGORY_ID || 1),
    provisionAuth: process.env.MOODLE_PROVISION_AUTH || 'manual',
    courseShortPrefix: process.env.MOODLE_COURSE_SHORT_PREFIX || 'clc',
  },

  // ── Moodle (local_crmbridge) → CRM webhook  (/api/lms/webhook/moodle) ──
  // Moodle signs every event; the CRM verifies. Same HMAC scheme as the
  // telephony webhook (services/lms/httpSign.js).
  webhook: {
    apiKey: process.env.MOODLE_WEBHOOK_KEY || '',
    hmacSecret: process.env.MOODLE_WEBHOOK_HMAC_SECRET || '',
    toleranceSec: Number(process.env.MOODLE_WEBHOOK_TOLERANCE_SEC || 300),
    // optional CIDR/IP allow-list, comma-separated. Empty = allow any (HMAC
    // still required). e.g. "203.0.113.10,10.0.0.0/8"
    allowIps: String(process.env.MOODLE_WEBHOOK_ALLOW_IPS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // ── CRM → Moodle single-sign-on (local_crmsso) ────────────────────────
  // The CRM mints a short-lived, single-use JWT; local_crmsso verifies it and
  // starts the Moodle session. The user never sees a Moodle login form.
  sso: {
    secret: process.env.MOODLE_SSO_SECRET || '',
    // login endpoint the CRM redirects the browser to
    loginPath: '/local/crmsso/login.php',
    logoutPath: '/local/crmsso/logout.php',
    tokenTtlSec: Number(process.env.MOODLE_SSO_TOKEN_TTL_SEC || 60),
    issuer: process.env.MOODLE_SSO_ISSUER || 'clc-crm',
    audience: process.env.MOODLE_SSO_AUDIENCE || 'moodle',
  },

  // ── BigBlueButton (dedicated host) ────────────────────────────────────
  // Now also the live-class meeting provider (services/lms/meeting/). When
  // url + secret are set the CRM creates + joins real BBB rooms; until then
  // it falls back to jitsi / mock and switches over automatically once set.
  bbb: {
    url: clean(process.env.BBB_URL), // https://bbb.example.com/bigbluebutton
    secret: process.env.BBB_SECRET || '',
    timeoutMs: Number(process.env.BBB_TIMEOUT_MS || 10000),
    checksumAlgo: (process.env.BBB_CHECKSUM_ALGO || 'sha1').toLowerCase(), // sha1 | sha256
    record: String(process.env.BBB_RECORD || 'true') === 'true',
    // shared token the bbb-webhooks module must send on ?token= (POST
    // /api/lms/webhooks/bbb). Optional but recommended.
    webhookToken: process.env.LMS_BBB_WEBHOOK_TOKEN || '',
  },

  // ── Live-class meeting provider ───────────────────────────────────────
  meeting: {
    // auto | bigbluebutton | jitsi | mock. `auto` = bigbluebutton when BBB is
    // configured, else Jitsi (real video — defaults to the public meet.jit.si
    // unless LMS_MEETING_JITSI_BASE points at your own instance). Set
    // LMS_MEETING_PROVIDER=mock to force the CRM's offline stand-in room.
    provider: (process.env.LMS_MEETING_PROVIDER || 'auto').toLowerCase(),
    jitsiBase: clean(process.env.LMS_MEETING_JITSI_BASE || 'https://meet.jit.si'),
    defaultDurationMin: Number(process.env.LMS_MEETING_DEFAULT_DURATION_MIN || 60),
    joinTicketTtlSec: Number(process.env.LMS_MEETING_JOIN_TICKET_TTL_SEC || 120),
    // One meeting room per BATCH, reused for every class of that batch for at
    // least this many months (spec: same link for 6 months).
    minBatchMonths: Number(process.env.LMS_MIN_BATCH_MONTHS || 6),
    // email students the batch class link + schedule on batch create / add.
    emailBatchStudents: String(process.env.LMS_EMAIL_BATCH_STUDENTS || 'true') === 'true',
    // public base URL of the CRM itself — used to build BBB logoutURL and the
    // ticket redirect. Falls back to APP_URL / PUBLIC_SERVER_FILE.
    crmBaseUrl: clean(process.env.LMS_CRM_BASE_URL || process.env.APP_URL || process.env.PUBLIC_SERVER_FILE || ''),
  },

  // Outbound sync queue (services/lms/queue.js + jobs/lmsSyncTick.js).
  sync: {
    tickMs: Number(process.env.LMS_SYNC_TICK_MS || 15000),
    maxAttempts: Number(process.env.LMS_SYNC_MAX_ATTEMPTS || 6),
    batchSize: Number(process.env.LMS_SYNC_BATCH_SIZE || 25),
    // nightly full reconciliation (hour in server local time, 0-23; -1 = off)
    reconcileHour: Number(process.env.LMS_SYNC_RECONCILE_HOUR || 3),
  },
};

config.moodle.restUrl = config.moodle.baseUrl
  ? config.moodle.baseUrl + config.moodle.restPath
  : '';

// True once the CRM can actually talk to Moodle.
config.isConfigured = !!(config.moodle.baseUrl && config.moodle.token);

// Effective meeting provider after resolving `auto`.
config.meeting.effectiveProvider = (() => {
  const p = config.meeting.provider;
  if (p === 'bigbluebutton' || p === 'bbb') return 'bigbluebutton';
  if (p === 'mock') return 'mock';
  if (p === 'jitsi') return config.meeting.jitsiBase ? 'jitsi' : 'mock';
  // auto
  if (config.bbb.url && config.bbb.secret) return 'bigbluebutton';
  if (config.meeting.jitsiBase) return 'jitsi';
  return 'mock';
})();

// A safe, frontend-exposable view — NO secrets.
function publicConfig() {
  return {
    configured: config.isConfigured,
    moodleBaseUrl: config.moodle.baseUrl || null,
    ssoEnabled: !!(config.isConfigured && config.sso.secret),
    webhookEnabled: !!config.webhook.hmacSecret,
    bbbConfigured: !!(config.bbb.url && config.bbb.secret),
    meetingProvider: config.meeting.effectiveProvider, // bigbluebutton | jitsi | mock
  };
}

module.exports = { lmsConfig: config, publicLmsConfig: publicConfig };
