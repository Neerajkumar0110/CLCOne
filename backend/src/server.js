// Must run before anything else touches Date/Intl — batch schedules, class
// times, "today's classes" etc. are all entered and read as India time, but
// a Date's setHours/getDay/etc. use whatever timezone the OS process is in
// (UTC by default on most hosts), which silently shifted every scheduled
// class time by +5:30 (e.g. 5:10 PM entered showed up as 10:40 PM). Setting
// TZ here — before mongoose/routes/etc. are required — makes every local-time
// Date method in the whole process mean IST, matching what was typed in.
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

require('module-alias/register');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const path = require('path');

// Make sure we are running node 7.6+
const [major, minor] = process.versions.node.split('.').map(parseFloat);
if (major < 20) {
  console.log('Please upgrade your node.js version at least 20 or greater. 👌\n ');
  process.exit();
}

// import environmental variables from our variables.env file
require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local' });

// Fail fast on a misconfigured .env instead of 500-ing at request time
// (mirrors the same check in api/index.js for the Vercel deployment).
const missingEnv = ['DATABASE', 'JWT_SECRET'].filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.log(`\n🚫 Missing required environment variable(s): ${missingEnv.join(', ')}`);
  console.log('   Add them to backend/.env (see backend/.env.example) and restart.\n');
  process.exit(1);
}
if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
  console.log('⚠️  GMAIL_USER / GMAIL_APP_PASSWORD not set — OTP login emails will fail.');
}

mongoose.connect(process.env.DATABASE);

// Routes every model to its own per-module database (salesDb, marketingDb,
// lmsDb, financeDb, hrmsDb, operationDb, coreDb) within this same cluster —
// must run before any model file below registers itself.
require('./config/multiDb').installMultiDbRouting();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

mongoose.connection.on('error', (error) => {
  console.log(
    `1. 🔥 Common Error caused issue → : check your .env file first and add your mongodb url`
  );
  console.error(`2. 🚫 Error → : ${error.message}`);
});

const modelsFiles = globSync('./src/models/**/*.js');

for (const filePath of modelsFiles) {
  require(path.resolve(filePath));
}

// Start our app!
const app = require('./app');
app.set('port', process.env.PORT || 8888);
const server = app.listen(app.get('port'), () => {
  console.log(`Express running → On PORT : ${server.address().port}`);
});

// Team chat's real-time transport (backend/src/socket.js) — needs the raw
// http.Server, not just the Express app, so it's wired here rather than in app.js.
const { initSocket } = require('./socket');
initSocket(server);

// ── Background jobs ────────────────────────────────────────────────────
// Every tick below acts on the WORLD, not just on this process: it emails
// students, dials customers, polls ad platforms and writes to the shared
// database. That is correct for the one real deployment and wrong for every
// other copy of this app.
//
// The hazard is concrete, not theoretical. A developer's .env is usually a
// copy of the production one — same Atlas DATABASE, same Gmail credentials,
// same NODE_ENV=production — so a laptop running `npm run dev` quietly
// became a second live sender. On 2026-10-09 that is exactly what happened:
// the laptop and the VPS each sent the same "Starting in 10 min" class
// reminder to the same students, the laptop's copy carrying a
// localhost:8888 join link, and the doubled SMTP login rate throttled the
// Gmail account so 143 of those reminders were lost outright.
//
// NODE_ENV cannot tell the two apart, precisely because the .env is copied.
// So this is an explicit switch, and it defaults to ON: the deployment must
// keep working untouched, and an operator who never sets the variable gets
// exactly today's behaviour. Any copy of this app that is NOT the single
// live deployment must set RUN_BACKGROUND_JOBS=false — see .env.example.
const RUN_BACKGROUND_JOBS = String(process.env.RUN_BACKGROUND_JOBS ?? 'true').toLowerCase() !== 'false';

if (!RUN_BACKGROUND_JOBS) {
  // Loud on purpose: "my reminder never went out" is otherwise a long hunt.
  console.log(
    'Background jobs DISABLED (RUN_BACKGROUND_JOBS=false) — no scheduled email, auto-dialing or ad-platform polling from this process.',
  );
} else {
  console.log('Background jobs ENABLED — this process sends real email and places real calls.');

  // Retries failed Facebook lead webhook deliveries (no queue infra exists in
  // this app, so this is a minimal in-process poller — see the file itself).
  const startFacebookWebhookRetryJob = require('./jobs/facebookWebhookRetry');
  startFacebookWebhookRetryJob();

  // Pulls Facebook Lead Ads leads from every lead form on each connected
  // Page — works while the Meta app is unpublished, which blocks the
  // webhook (see jobs/facebookLeadPoller.js).
  const startFacebookLeadPoller = require('./jobs/facebookLeadPoller');
  startFacebookLeadPoller();

  // Retries failed Google Ads lead webhook deliveries — same shape as Facebook's.
  const startGoogleWebhookRetryJob = require('./jobs/googleWebhookRetry');
  startGoogleWebhookRetryJob();

  // LinkedIn has no webhook — this poller IS the primary way LinkedIn leads
  // enter the app (see jobs/linkedinLeadPoller.js), not just a retry path.
  const startLinkedInLeadPoller = require('./jobs/linkedinLeadPoller');
  startLinkedInLeadPoller();

  // Calling auto-dialer heartbeat — feeds Available agents the next lead on
  // Active campaigns, clears stuck calls (no-op unless CALLING_PROVIDER is set).
  const startCallingDialerTick = require('./jobs/callingDialerTick');
  startCallingDialerTick();

  // Rings scheduled callbacks at the time the agent promised the customer,
  // waiting for that same agent to be free. See the job file for why it is
  // deliberately stricter than the campaign dialer above.
  const startCallingCallbackTick = require('./jobs/callingCallbackTick');
  startCallingCallbackTick();

  // Pulls call-recording links from the provider's Recording API for any
  // recently completed call that isn't marked available yet — the provider's
  // own push callback isn't reliably reaching this server (see the job file
  // for what was actually verified). No-op unless CALLING_PROVIDER=cloud.
  const startCallingRecordingSync = require('./jobs/callingRecordingSync');
  startCallingRecordingSync();

  // Feeds the per-agent "Instant Lead Pool" auto-dialer toggle straight from
  // unassigned New Lead stage Sales leads, and tells participating agents
  // when it runs dry. See jobs/leadPoolSyncTick.js.
  const startLeadPoolSyncTick = require('./jobs/leadPoolSyncTick');
  startLeadPoolSyncTick();

  // End-of-day email to every agent who missed at least one routed call today
  // (never picked up — see CallRecord.missedByAgent / plivoAnswer.js's
  // leg=agent-hangup branch). No-op unless CALLING_PROVIDER=cloud, since
  // missedByAgent is only ever set by the Plivo hangup callback.
  const startMissedCallDailySummaryTick = require('./jobs/missedCallDailySummaryTick');
  startMissedCallDailySummaryTick();

  // LMS ⇄ Moodle sync worker — drains the outbound queue (LmsSyncJob), retries
  // failed inbound webhook events, runs the nightly reconcile. No-op until
  // MOODLE_WS_URL / MOODLE_WS_TOKEN are set (see services/lms/, config/lms.js).
  const startLmsSyncTick = require('./jobs/lmsSyncTick');
  startLmsSyncTick();

  // LMS live-class worker — lifecycle transitions (scheduled->upcoming, auto
  // start/end per policy), BBB recording polling, and class notifications.
  const startLmsLiveTick = require('./jobs/lmsLiveTick');
  startLmsLiveTick();

  // LMS policy-acknowledgement reminders (spec §8/§12) — email + in-app only
  // (no WhatsApp leg yet). Re-reminds any pending acknowledgement on a cycle.
  const startLmsPolicyReminderTick = require('./jobs/lmsPolicyReminderTick');
  startLmsPolicyReminderTick();

  // LMS daily attendance + admin-health summary email (spec §12 "reporting
  // dependent on manual sheets") — once/day to management, on top of the
  // already-real-time Attendance dashboard + CSV/XLSX export.
  const startLmsDailySummaryTick = require('./jobs/lmsDailySummaryTick');
  startLmsDailySummaryTick();

  // Daily reminder to every Support-role account of how many students still
  // have no batch assigned — stops on its own the day that count hits 0.
  const startLmsUnassignedBatchTick = require('./jobs/lmsUnassignedBatchTick');
  startLmsUnassignedBatchTick();

  // Finance EMI automation — auto-creates each installment's payment link 10
  // days before it's due, emails reminders (10/7/5 days before, then daily
  // through the due date), and puts a student's LMS access on hold 24h past
  // due (auto-restored the instant they pay — see services/payments/financeHold.js).
  const startFinanceEmiTick = require('./jobs/financeEmiTick');
  startFinanceEmiTick();

  // Code Editor file-save audit trail — watches the workspace filesystem
  // (skipped entirely while no one has an open Code Editor session) and
  // writes to the shared AuditLog, since OpenVSCode Server is a separate
  // process the backend doesn't otherwise hear save events from.
  const startCodeEditorFileAuditTick = require('./jobs/codeEditorFileAuditTick');
  startCodeEditorFileAuditTick();
}
