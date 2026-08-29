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
