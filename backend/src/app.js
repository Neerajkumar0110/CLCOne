const express = require('express');

const cors = require('cors');
const compression = require('compression');

const cookieParser = require('cookie-parser');

const coreAuthRouter = require('./routes/coreRoutes/coreAuth');
const coreApiRouter = require('./routes/coreRoutes/coreApi');
const coreDownloadRouter = require('./routes/coreRoutes/coreDownloadRouter');
const corePublicRouter = require('./routes/coreRoutes/corePublicRouter');
const adminAuth = require('./controllers/coreControllers/adminAuth');

const errorHandlers = require('./handlers/errorHandlers');
const erpApiRouter = require('./routes/appRoutes/appApi');
const callingApiRouter = require('./routes/appRoutes/callingApi');
const telephonyWebhookRouter = require('./routes/appRoutes/telephonyWebhookApi');
const telephonyHmacAuth = require('./middlewares/telephonyHmacAuth');
const cloudCallWebhookRouter = require('./routes/appRoutes/cloudCallWebhookApi');
const lmsWebhookRouter = require('./routes/appRoutes/lmsWebhookApi');
const lmsLivePublicRouter = require('./routes/appRoutes/lmsLivePublicApi');
const lmsBbbWebhookRouter = require('./routes/appRoutes/lmsBbbWebhookApi');
const lmsApiRouter = require('./routes/appRoutes/lmsApi');
const facebookApiRouter = require('./routes/appRoutes/facebookApi');
const googleApiRouter = require('./routes/appRoutes/googleApi');
const linkedinApiRouter = require('./routes/appRoutes/linkedinApi');
const gitApiRouter = require('./routes/appRoutes/gitApi');
const vercelApiRouter = require('./routes/appRoutes/vercelApi');

const fileUpload = require('express-fileupload');
// create our Express app
const app = express();

// Behind a reverse proxy (Nginx on the VPS, or Vercel's edge) the client IP
// arrives in X-Forwarded-For. Trust the first hop so express-rate-limit keys
// on the real IP instead of the proxy's, and req.protocol reflects https.
app.set('trust proxy', 1);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(cookieParser());
// verify: stash the exact bytes so the telephony webhook can HMAC-check
// the raw body. Harmless for every other route.
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf && buf.length ? buf.toString('utf8') : '';
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.use(compression());

// // default options
// app.use(fileUpload());

// Here our API Routes

// VPS → CRM telephony webhooks. Mounted BEFORE the bearer-gated /api
// routers and protected by an HMAC signature instead of a CRM login
// (the telephony server has no CRM session). See spec §12–14.
app.use('/api/telephony', telephonyHmacAuth, telephonyWebhookRouter);

// Cloud calling provider (Tata Smartflo / Exotel / …) status callbacks —
// also before the bearer gate; the router checks its own shared secret.
app.use('/api/cloud-call', cloudCallWebhookRouter);

// Moodle (local_crmbridge) → CRM event webhooks. Before the bearer gate;
// every request is HMAC-signed with MOODLE_WEBHOOK_HMAC_SECRET.
app.use('/api/lms/webhook', lmsWebhookRouter);

// Live-class one-time join redirect + leave beacon + mock room — before the
// bearer gate; guarded by a single-use short-lived ticket / per-session key.
app.use('/api/lms/live', lmsLivePublicRouter);

// BigBlueButton event callbacks — before the bearer gate; token / checksum
// checked in the handler, idempotent.
app.use('/api/lms/webhooks', lmsBbbWebhookRouter);

app.use('/api', coreAuthRouter);
app.use('/api', adminAuth.isValidAuthToken, coreApiRouter);
app.use('/api', adminAuth.isValidAuthToken, erpApiRouter);
app.use('/api/calling', adminAuth.isValidAuthToken, callingApiRouter);
app.use('/api/lms', adminAuth.isValidAuthToken, lmsApiRouter);
app.use('/api/facebook', adminAuth.isValidAuthToken, facebookApiRouter);
app.use('/api/google', adminAuth.isValidAuthToken, googleApiRouter);
app.use('/api/linkedin', adminAuth.isValidAuthToken, linkedinApiRouter);
app.use('/api/git', adminAuth.isValidAuthToken, gitApiRouter);
app.use('/api/vercel', adminAuth.isValidAuthToken, vercelApiRouter);
app.use('/download', coreDownloadRouter);
app.use('/public', corePublicRouter);

// If that above routes didnt work, we 404 them and forward to error handler
app.use(errorHandlers.notFound);

// production error handler
app.use(errorHandlers.productionErrors);

// done! we export it so we can start the site in start.js
module.exports = app;
