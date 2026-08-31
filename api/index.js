let app;
let bootError;
// Assigned inside the try below; awaited by the exported handler before
// every request. Default keeps the fallback export working if boot fails.
let connectDb = () => Promise.resolve();

try {
  const path = require('path');
  const mongoose = require('mongoose');

  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

  // The local .env file is NOT bundled into the Vercel function (see
  // vercel.json `includeFiles`), so in production every value must be set
  // in the Vercel project's Environment Variables. Fail the boot with a
  // clear message instead of silently 500-ing later — e.g. a missing
  // JWT_SECRET lets login + the OTP email succeed but makes verifyOtp's
  // jwt.sign() throw "secretOrPrivateKey must have a value" on every call.
  const requiredEnv = ['DATABASE', 'JWT_SECRET'];
  const missingEnv = requiredEnv.filter((key) => !process.env[key]);
  if (missingEnv.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missingEnv.join(', ')}. ` +
        'Set them in the Vercel project settings (Production scope) and redeploy.'
    );
  }
  for (const key of ['GMAIL_USER', 'GMAIL_APP_PASSWORD']) {
    if (!process.env[key]) console.warn(`[boot] ${key} is not set — OTP login emails will fail.`);
  }

  // Serverless connection handling: cache one connect promise across
  // invocations and await it on every request (see the handler at the
  // bottom). A fire-and-forget connect() lets a request start handling
  // while the socket is still "connecting", so queries buffer and then
  // throw "buffered timed out after 10000ms"; a rejected connect() that
  // nothing awaits can also wedge a warm instance so it fails on every
  // later request. Nulling the cached promise on failure lets the next
  // request retry cleanly.
  mongoose.set('bufferTimeoutMS', 15000);
  connectDb = () => {
    if (mongoose.connection.readyState === 1) return Promise.resolve();
    if (!connectDb.promise) {
      connectDb.promise = mongoose
        .connect(process.env.DATABASE, {
          serverSelectionTimeoutMS: 10000,
          socketTimeoutMS: 45000,
          maxPoolSize: 5,
        })
        .catch((err) => {
          connectDb.promise = null;
          throw err;
        });
    }
    return connectDb.promise;
  };

  mongoose.connection.on('error', (error) => {
    console.error(`MongoDB connection error: ${error.message}`);
  });

  // Vercel's build bundles this service with Rolldown, which wraps
  // requires to local (non-npm) files in a lazy getter — plain Node's
  // require() returns that wrapper, not the module's real
  // module.exports, until something reads `.default` off it. That left
  // every model file's mongoose.model(...) registration call unexecuted
  // ("Model X does not exist" at request time). unwrap() reads `.default`
  // when present (Rolldown build) and falls back to the value itself
  // (plain local `node src/server.js`, no bundler involved).
  const unwrap = (mod) => (mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod);

  const models = {
    Call: unwrap(require('../src/models/appModels/Call')),
    CaptureFormConfig: unwrap(require('../src/models/appModels/CaptureFormConfig')),
    Client: unwrap(require('../src/models/appModels/Client')),
    FacebookAd: unwrap(require('../src/models/appModels/FacebookAd')),
    FacebookAdCreative: unwrap(require('../src/models/appModels/FacebookAdCreative')),
    FacebookAdSet: unwrap(require('../src/models/appModels/FacebookAdSet')),
    FacebookCampaign: unwrap(require('../src/models/appModels/FacebookCampaign')),
    FacebookConnection: unwrap(require('../src/models/appModels/FacebookConnection')),
    FacebookWebhookLog: unwrap(require('../src/models/appModels/FacebookWebhookLog')),
    GitConnection: unwrap(require('../src/models/appModels/GitConnection')),
    GoogleAd: unwrap(require('../src/models/appModels/GoogleAd')),
    GoogleAdGroup: unwrap(require('../src/models/appModels/GoogleAdGroup')),
    GoogleCampaign: unwrap(require('../src/models/appModels/GoogleCampaign')),
    GoogleConnection: unwrap(require('../src/models/appModels/GoogleConnection')),
    GoogleWebhookLog: unwrap(require('../src/models/appModels/GoogleWebhookLog')),
    Invoice: unwrap(require('../src/models/appModels/Invoice')),
    Lead: unwrap(require('../src/models/appModels/Lead')),
    LeadImportBatch: unwrap(require('../src/models/appModels/LeadImportBatch')),
    LinkedInCampaign: unwrap(require('../src/models/appModels/LinkedInCampaign')),
    LinkedInCampaignGroup: unwrap(require('../src/models/appModels/LinkedInCampaignGroup')),
    LinkedInConnection: unwrap(require('../src/models/appModels/LinkedInConnection')),
    LinkedInCreative: unwrap(require('../src/models/appModels/LinkedInCreative')),
    LinkedInLeadSyncLog: unwrap(require('../src/models/appModels/LinkedInLeadSyncLog')),
    LoginActivity: unwrap(require('../src/models/appModels/LoginActivity')),
    Message: unwrap(require('../src/models/appModels/Message')),
    Notification: unwrap(require('../src/models/appModels/Notification')),
    Payment: unwrap(require('../src/models/appModels/Payment')),
    Permission: unwrap(require('../src/models/appModels/Permission')),
    Shift: unwrap(require('../src/models/appModels/Shift')),
    Team: unwrap(require('../src/models/appModels/Team')),
    Ticket: unwrap(require('../src/models/appModels/Ticket')),
    VercelConnection: unwrap(require('../src/models/appModels/VercelConnection')),

    // Feature-section models (Sales / Marketing / Operations / LMS / HR /
    // Messenger — see config/featureSections.js + scripts/genFeatureModels.cjs).
    // MUST be force-required here: models/utils globs the filenames into
    // routesList and appControllers eagerly calls mongoose.model(name) for
    // each, so a schema that never gets registered (Rolldown lazy-wraps local
    // requires on Vercel) throws MissingSchemaError and 500s the whole app.
    SalesDeal: unwrap(require('../src/models/appModels/SalesDeal')),
    SalesQuote: unwrap(require('../src/models/appModels/SalesQuote')),
    SalesOrder: unwrap(require('../src/models/appModels/SalesOrder')),
    Product: unwrap(require('../src/models/appModels/Product')),
    Campaign: unwrap(require('../src/models/appModels/Campaign')),
    EmailBroadcast: unwrap(require('../src/models/appModels/EmailBroadcast')),
    Journey: unwrap(require('../src/models/appModels/Journey')),
    Segment: unwrap(require('../src/models/appModels/Segment')),
    OpsProject: unwrap(require('../src/models/appModels/OpsProject')),
    OpsDelivery: unwrap(require('../src/models/appModels/OpsDelivery')),
    Vendor: unwrap(require('../src/models/appModels/Vendor')),
    OpsDocument: unwrap(require('../src/models/appModels/OpsDocument')),
    Approval: unwrap(require('../src/models/appModels/Approval')),
    Course: unwrap(require('../src/models/appModels/Course')),
    Batch: unwrap(require('../src/models/appModels/Batch')),
    Student: unwrap(require('../src/models/appModels/Student')),
    LiveClass: unwrap(require('../src/models/appModels/LiveClass')),
    AttendanceRecord: unwrap(require('../src/models/appModels/AttendanceRecord')),
    Certificate: unwrap(require('../src/models/appModels/Certificate')),
    Employee: unwrap(require('../src/models/appModels/Employee')),
    Candidate: unwrap(require('../src/models/appModels/Candidate')),
    HrAttendance: unwrap(require('../src/models/appModels/HrAttendance')),
    LeaveRequest: unwrap(require('../src/models/appModels/LeaveRequest')),
    Payslip: unwrap(require('../src/models/appModels/Payslip')),
    Appraisal: unwrap(require('../src/models/appModels/Appraisal')),
    HrOnboarding: unwrap(require('../src/models/appModels/HrOnboarding')),
    Timesheet: unwrap(require('../src/models/appModels/Timesheet')),
    ShiftRoster: unwrap(require('../src/models/appModels/ShiftRoster')),
    Holiday: unwrap(require('../src/models/appModels/Holiday')),
    ExpenseClaim: unwrap(require('../src/models/appModels/ExpenseClaim')),
    LoanAdvance: unwrap(require('../src/models/appModels/LoanAdvance')),
    TrainingProgram: unwrap(require('../src/models/appModels/TrainingProgram')),
    HrAsset: unwrap(require('../src/models/appModels/HrAsset')),
    HrDocument: unwrap(require('../src/models/appModels/HrDocument')),
    HrTicket: unwrap(require('../src/models/appModels/HrTicket')),
    Announcement: unwrap(require('../src/models/appModels/Announcement')),
    Recognition: unwrap(require('../src/models/appModels/Recognition')),
    ExitRecord: unwrap(require('../src/models/appModels/ExitRecord')),
    MessengerContact: unwrap(require('../src/models/appModels/MessengerContact')),
    MessengerConversation: unwrap(require('../src/models/appModels/MessengerConversation')),
    MessengerBroadcast: unwrap(require('../src/models/appModels/MessengerBroadcast')),

    Admin: unwrap(require('../src/models/coreModels/Admin')),
    AdminPassword: unwrap(require('../src/models/coreModels/AdminPassword')),
    Setting: unwrap(require('../src/models/coreModels/Setting')),
    Upload: unwrap(require('../src/models/coreModels/Upload')),
  };

  const unloaded = Object.entries(models).filter(([, model]) => !model);
  if (unloaded.length > 0) {
    throw new Error(`Failed to load models: ${unloaded.map(([name]) => name).join(', ')}`);
  }

  app = unwrap(require('../src/app'));
} catch (error) {
  bootError = error;
  console.error('Serverless bootstrap failed:', error);
}

module.exports = app
  ? async (req, res) => {
      try {
        await connectDb();
      } catch (err) {
        console.error('Request aborted — database connection failed:', err.message);
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        return res.end(
          JSON.stringify({ success: false, message: 'Database connection failed', error: err.message })
        );
      }
      return app(req, res);
    }
  : (req, res) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: false,
          message: 'Serverless bootstrap failed',
          error: bootError ? bootError.message : 'unknown',
          stack: bootError ? bootError.stack : undefined,
        })
      );
    };
