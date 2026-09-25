// Must run before anything else touches Date/Intl — see the matching
// comment in src/server.js for why (batch/class times entered as India
// time were silently shifting by +5:30 without this).
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

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

  // Routes every model to its own per-module database (salesDb, marketingDb,
  // lmsDb, financeDb, hrmsDb, operationDb, coreDb) within this same cluster —
  // must run before any model below registers itself.
  unwrap(require('../src/config/multiDb')).installMultiDbRouting();

  // Every model, grouped by the same 7 modules multiDb.js routes them to
  // (salesDb/marketingDb/lmsDb/financeDb/hrmsDb/operationDb/coreDb) — see
  // backend/MODULES.md for the full module -> database map. MUST be force-
  // required here: models/utils globs the filenames into routesList and
  // appControllers eagerly calls mongoose.model(name) for each, so a schema
  // that never gets registered (Rolldown lazy-wraps local requires on
  // Vercel) throws MissingSchemaError and 500s the whole app.
  const models = {
    // ---- sales (salesDb) ----
    Client: unwrap(require('../src/models/appModels/sales/Client')),
    Lead: unwrap(require('../src/models/appModels/sales/Lead')),
    LeadImportBatch: unwrap(require('../src/models/appModels/sales/LeadImportBatch')),
    SalesCost: unwrap(require('../src/models/appModels/sales/SalesCost')),
    SalesDeal: unwrap(require('../src/models/appModels/sales/SalesDeal')),
    SalesQuote: unwrap(require('../src/models/appModels/sales/SalesQuote')),
    SalesOrder: unwrap(require('../src/models/appModels/sales/SalesOrder')),
    Product: unwrap(require('../src/models/appModels/sales/Product')),

    // ---- marketing (marketingDb) ----
    CaptureFormConfig: unwrap(require('../src/models/appModels/marketing/CaptureFormConfig')),
    FacebookAd: unwrap(require('../src/models/appModels/marketing/FacebookAd')),
    FacebookAdCreative: unwrap(require('../src/models/appModels/marketing/FacebookAdCreative')),
    FacebookAdSet: unwrap(require('../src/models/appModels/marketing/FacebookAdSet')),
    FacebookCampaign: unwrap(require('../src/models/appModels/marketing/FacebookCampaign')),
    FacebookConnection: unwrap(require('../src/models/appModels/marketing/FacebookConnection')),
    FacebookWebhookLog: unwrap(require('../src/models/appModels/marketing/FacebookWebhookLog')),
    GoogleAd: unwrap(require('../src/models/appModels/marketing/GoogleAd')),
    GoogleAdGroup: unwrap(require('../src/models/appModels/marketing/GoogleAdGroup')),
    GoogleCampaign: unwrap(require('../src/models/appModels/marketing/GoogleCampaign')),
    GoogleConnection: unwrap(require('../src/models/appModels/marketing/GoogleConnection')),
    GoogleWebhookLog: unwrap(require('../src/models/appModels/marketing/GoogleWebhookLog')),
    MarketingMetric: unwrap(require('../src/models/appModels/marketing/MarketingMetric')),
    LinkedInCampaign: unwrap(require('../src/models/appModels/marketing/LinkedInCampaign')),
    LinkedInCampaignGroup: unwrap(require('../src/models/appModels/marketing/LinkedInCampaignGroup')),
    LinkedInConnection: unwrap(require('../src/models/appModels/marketing/LinkedInConnection')),
    LinkedInCreative: unwrap(require('../src/models/appModels/marketing/LinkedInCreative')),
    LinkedInLeadSyncLog: unwrap(require('../src/models/appModels/marketing/LinkedInLeadSyncLog')),
    Campaign: unwrap(require('../src/models/appModels/marketing/Campaign')),
    EmailBroadcast: unwrap(require('../src/models/appModels/marketing/EmailBroadcast')),
    Journey: unwrap(require('../src/models/appModels/marketing/Journey')),
    Segment: unwrap(require('../src/models/appModels/marketing/Segment')),

    // ---- operation (operationDb) — calling/call-center, git/vercel
    // connections, messenger, ops projects.
    Call: unwrap(require('../src/models/appModels/operation/Call')),
    GitConnection: unwrap(require('../src/models/appModels/operation/GitConnection')),
    CallCampaign: unwrap(require('../src/models/appModels/operation/CallCampaign')),
    CallLead: unwrap(require('../src/models/appModels/operation/CallLead')),
    CallRecord: unwrap(require('../src/models/appModels/operation/CallRecord')),
    CallCallback: unwrap(require('../src/models/appModels/operation/CallCallback')),
    AgentCallState: unwrap(require('../src/models/appModels/operation/AgentCallState')),
    IvrFlow: unwrap(require('../src/models/appModels/operation/IvrFlow')),
    TelephonyEvent: unwrap(require('../src/models/appModels/operation/TelephonyEvent')),
    Message: unwrap(require('../src/models/appModels/operation/Message')),
    Notification: unwrap(require('../src/models/appModels/operation/Notification')),
    VercelConnection: unwrap(require('../src/models/appModels/operation/VercelConnection')),
    OpsProject: unwrap(require('../src/models/appModels/operation/OpsProject')),
    OpsDelivery: unwrap(require('../src/models/appModels/operation/OpsDelivery')),
    Vendor: unwrap(require('../src/models/appModels/operation/Vendor')),
    OpsDocument: unwrap(require('../src/models/appModels/operation/OpsDocument')),
    Approval: unwrap(require('../src/models/appModels/operation/Approval')),
    MessengerContact: unwrap(require('../src/models/appModels/operation/MessengerContact')),
    MessengerConversation: unwrap(require('../src/models/appModels/operation/MessengerConversation')),
    MessengerBroadcast: unwrap(require('../src/models/appModels/operation/MessengerBroadcast')),

    // ---- finance (financeDb) ----
    Invoice: unwrap(require('../src/models/appModels/finance/Invoice')),
    Payment: unwrap(require('../src/models/appModels/finance/Payment')),
    PaymentRequest: unwrap(require('../src/models/appModels/finance/PaymentRequest')),
    PaymentKyc: unwrap(require('../src/models/appModels/finance/PaymentKyc')),

    // ---- hrms (hrmsDb) ----
    LoginActivity: unwrap(require('../src/models/appModels/hrms/LoginActivity')),
    Shift: unwrap(require('../src/models/appModels/hrms/Shift')),
    Employee: unwrap(require('../src/models/appModels/hrms/Employee')),
    Candidate: unwrap(require('../src/models/appModels/hrms/Candidate')),
    HrAttendance: unwrap(require('../src/models/appModels/hrms/HrAttendance')),
    LeaveRequest: unwrap(require('../src/models/appModels/hrms/LeaveRequest')),
    Payslip: unwrap(require('../src/models/appModels/hrms/Payslip')),
    Appraisal: unwrap(require('../src/models/appModels/hrms/Appraisal')),
    HrOnboarding: unwrap(require('../src/models/appModels/hrms/HrOnboarding')),
    Timesheet: unwrap(require('../src/models/appModels/hrms/Timesheet')),
    ShiftRoster: unwrap(require('../src/models/appModels/hrms/ShiftRoster')),
    Holiday: unwrap(require('../src/models/appModels/hrms/Holiday')),
    ExpenseClaim: unwrap(require('../src/models/appModels/hrms/ExpenseClaim')),
    LoanAdvance: unwrap(require('../src/models/appModels/hrms/LoanAdvance')),
    TrainingProgram: unwrap(require('../src/models/appModels/hrms/TrainingProgram')),
    HrAsset: unwrap(require('../src/models/appModels/hrms/HrAsset')),
    HrDocument: unwrap(require('../src/models/appModels/hrms/HrDocument')),
    HrTicket: unwrap(require('../src/models/appModels/hrms/HrTicket')),
    Announcement: unwrap(require('../src/models/appModels/hrms/Announcement')),
    Recognition: unwrap(require('../src/models/appModels/hrms/Recognition')),
    ExitRecord: unwrap(require('../src/models/appModels/hrms/ExitRecord')),

    // ---- lms (lmsDb) — includes Support/Ticket per product decision, and
    // the LMS ⇄ Moodle integration models (services/lms/, config/lms.js).
    Ticket: unwrap(require('../src/models/appModels/lms/Ticket')),
    Course: unwrap(require('../src/models/appModels/lms/Course')),
    Batch: unwrap(require('../src/models/appModels/lms/Batch')),
    Student: unwrap(require('../src/models/appModels/lms/Student')),
    LiveClass: unwrap(require('../src/models/appModels/lms/LiveClass')),
    AttendanceRecord: unwrap(require('../src/models/appModels/lms/AttendanceRecord')),
    Certificate: unwrap(require('../src/models/appModels/lms/Certificate')),
    MoodleUserMap: unwrap(require('../src/models/appModels/lms/MoodleUserMap')),
    MoodleObjectMap: unwrap(require('../src/models/appModels/lms/MoodleObjectMap')),
    LmsEnrolment: unwrap(require('../src/models/appModels/lms/LmsEnrolment')),
    LmsWebhookEvent: unwrap(require('../src/models/appModels/lms/LmsWebhookEvent')),
    LmsSyncJob: unwrap(require('../src/models/appModels/lms/LmsSyncJob')),
    LmsLiveSession: unwrap(require('../src/models/appModels/lms/LmsLiveSession')),
    LmsSetting: unwrap(require('../src/models/appModels/lms/LmsSetting')),
    LiveRecording: unwrap(require('../src/models/appModels/lms/LiveRecording')),
    LmsBatchRoom: unwrap(require('../src/models/appModels/lms/LmsBatchRoom')),
    CourseModule: unwrap(require('../src/models/appModels/lms/CourseModule')),
    Chapter: unwrap(require('../src/models/appModels/lms/Chapter')),
    Lesson: unwrap(require('../src/models/appModels/lms/Lesson')),
    LessonProgress: unwrap(require('../src/models/appModels/lms/LessonProgress')),
    CourseProgress: unwrap(require('../src/models/appModels/lms/CourseProgress')),
    Assignment: unwrap(require('../src/models/appModels/lms/Assignment')),
    AssignmentSubmission: unwrap(require('../src/models/appModels/lms/AssignmentSubmission')),
    Quiz: unwrap(require('../src/models/appModels/lms/Quiz')),
    Question: unwrap(require('../src/models/appModels/lms/Question')),
    QuizAttempt: unwrap(require('../src/models/appModels/lms/QuizAttempt')),
    Doubt: unwrap(require('../src/models/appModels/lms/Doubt')),
    LmsAnnouncement: unwrap(require('../src/models/appModels/lms/LmsAnnouncement')),
    CertificateRule: unwrap(require('../src/models/appModels/lms/CertificateRule')),
    PolicyDocument: unwrap(require('../src/models/appModels/lms/PolicyDocument')),
    PolicyAcknowledgement: unwrap(require('../src/models/appModels/lms/PolicyAcknowledgement')),
    AuditLog: unwrap(require('../src/models/appModels/lms/AuditLog')),
    EmailDeliveryLog: unwrap(require('../src/models/appModels/lms/EmailDeliveryLog')),
    NotificationTemplate: unwrap(require('../src/models/appModels/lms/NotificationTemplate')),
    EligibilityRule: unwrap(require('../src/models/appModels/lms/EligibilityRule')),
    Project: unwrap(require('../src/models/appModels/lms/Project')),
    // Proctored-assessment subsystem (ported from python-test-platform) — was
    // missing from this force-require list entirely (pre-existing gap, found
    // while verifying the Vercel serverless boot path); without these, every
    // /api/lms/assessments/* route 500s on serverless with MissingSchemaError.
    AssessmentQuestion: unwrap(require('../src/models/appModels/lms/assessments/AssessmentQuestion')),
    AssessmentProctorEvent: unwrap(require('../src/models/appModels/lms/assessments/AssessmentProctorEvent')),
    AssessmentRoundRobinCursor: unwrap(require('../src/models/appModels/lms/assessments/AssessmentRoundRobinCursor')),
    AssessmentCurriculumSession: unwrap(require('../src/models/appModels/lms/assessments/AssessmentCurriculumSession')),
    AssessmentDeliveryRecord: unwrap(require('../src/models/appModels/lms/assessments/AssessmentDeliveryRecord')),
    AssessmentAttempt: unwrap(require('../src/models/appModels/lms/assessments/AssessmentAttempt')),
    AssessmentAttemptQuestion: unwrap(require('../src/models/appModels/lms/assessments/AssessmentAttemptQuestion')),

    // ---- core (coreDb) — shared/auth, plus appModels/core (Team, Permission).
    Permission: unwrap(require('../src/models/appModels/core/Permission')),
    Team: unwrap(require('../src/models/appModels/core/Team')),
    Admin: unwrap(require('../src/models/coreModels/Admin')),
    AdminPassword: unwrap(require('../src/models/coreModels/AdminPassword')),
    Setting: unwrap(require('../src/models/coreModels/Setting')),
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
