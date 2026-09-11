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

// Retries failed Facebook lead webhook deliveries (no queue infra exists in
// this app, so this is a minimal in-process poller — see the file itself).
const startFacebookWebhookRetryJob = require('./jobs/facebookWebhookRetry');
startFacebookWebhookRetryJob();

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

// LMS ⇄ Moodle sync worker — drains the outbound queue (LmsSyncJob), retries
// failed inbound webhook events, runs the nightly reconcile. No-op until
// MOODLE_WS_URL / MOODLE_WS_TOKEN are set (see services/lms/, config/lms.js).
const startLmsSyncTick = require('./jobs/lmsSyncTick');
startLmsSyncTick();

// LMS live-class worker — lifecycle transitions (scheduled->upcoming, auto
// start/end per policy), BBB recording polling, and class notifications.
const startLmsLiveTick = require('./jobs/lmsLiveTick');
startLmsLiveTick();
