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
const facebookApiRouter = require('./routes/appRoutes/facebookApi');
const googleApiRouter = require('./routes/appRoutes/googleApi');
const linkedinApiRouter = require('./routes/appRoutes/linkedinApi');
const gitApiRouter = require('./routes/appRoutes/gitApi');
const vercelApiRouter = require('./routes/appRoutes/vercelApi');

const fileUpload = require('express-fileupload');
// create our Express app
const app = express();

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

app.use('/api', coreAuthRouter);
app.use('/api', adminAuth.isValidAuthToken, coreApiRouter);
app.use('/api', adminAuth.isValidAuthToken, erpApiRouter);
app.use('/api/calling', adminAuth.isValidAuthToken, callingApiRouter);
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
