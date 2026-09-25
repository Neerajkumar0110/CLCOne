// Splits the single Atlas cluster's data across 7 logical databases without
// touching any model file's `mongoose.model('Name', schema)` registration
// call or any controller's `mongoose.model('Name')` lookup call. Both call
// shapes get transparently redirected to the correct
// `connection.useDb(dbName, { useCache: true })` connection instead of the
// default connection opened by `mongoose.connect(process.env.DATABASE)`.
//
// Must be required (and `installMultiDbRouting()` called) AFTER
// `mongoose.connect(...)` but BEFORE anything else calls `mongoose.model()`
// — i.e. before the model-file glob-require loop in server.js / the manual
// model requires in api/index.js.

const mongoose = require('mongoose');

// Canonical model name -> target database name. Every model must appear
// here exactly once. This is the single source of truth for "which
// database owns this collection" — migration scripts import DB_MAP from
// here rather than duplicating the mapping.
const DB_MAP = {
  // ---- salesDb ----
  Client: 'salesDb',
  Lead: 'salesDb',
  LeadImportBatch: 'salesDb',
  Product: 'salesDb',
  SalesCost: 'salesDb',
  SalesDeal: 'salesDb',
  SalesOrder: 'salesDb',
  SalesQuote: 'salesDb',

  // ---- marketingDb ----
  Campaign: 'marketingDb',
  CaptureFormConfig: 'marketingDb',
  EmailBroadcast: 'marketingDb',
  FacebookAd: 'marketingDb',
  FacebookAdCreative: 'marketingDb',
  FacebookAdSet: 'marketingDb',
  FacebookCampaign: 'marketingDb',
  FacebookConnection: 'marketingDb',
  FacebookWebhookLog: 'marketingDb',
  GoogleAd: 'marketingDb',
  GoogleAdGroup: 'marketingDb',
  GoogleCampaign: 'marketingDb',
  GoogleConnection: 'marketingDb',
  GoogleWebhookLog: 'marketingDb',
  Journey: 'marketingDb',
  LinkedInCampaign: 'marketingDb',
  LinkedInCampaignGroup: 'marketingDb',
  LinkedInConnection: 'marketingDb',
  LinkedInCreative: 'marketingDb',
  LinkedInLeadSyncLog: 'marketingDb',
  MarketingMetric: 'marketingDb',
  Segment: 'marketingDb',

  // ---- lmsDb (includes Support/Ticket per product decision) ----
  Assignment: 'lmsDb',
  AssignmentSubmission: 'lmsDb',
  AuditLog: 'lmsDb',
  EligibilityRule: 'lmsDb',
  PolicyAcknowledgement: 'lmsDb',
  PolicyDocument: 'lmsDb',
  Project: 'lmsDb',
  // ported from the python-test-platform reference project (Prisma/Postgres -> Mongoose)
  AssessmentAttempt: 'lmsDb',
  AssessmentAttemptQuestion: 'lmsDb',
  AssessmentCurriculumSession: 'lmsDb',
  AssessmentDeliveryRecord: 'lmsDb',
  AssessmentProctorEvent: 'lmsDb',
  AssessmentQuestion: 'lmsDb',
  AssessmentRoundRobinCursor: 'lmsDb',
  AttendanceRecord: 'lmsDb',
  Batch: 'lmsDb',
  Certificate: 'lmsDb',
  CertificateRule: 'lmsDb',
  Chapter: 'lmsDb',
  Course: 'lmsDb',
  CourseModule: 'lmsDb',
  CourseProgress: 'lmsDb',
  Doubt: 'lmsDb',
  EmailDeliveryLog: 'lmsDb',
  Lesson: 'lmsDb',
  LessonProgress: 'lmsDb',
  LiveClass: 'lmsDb',
  LiveRecording: 'lmsDb',
  LmsAnnouncement: 'lmsDb',
  LmsBatchRoom: 'lmsDb',
  LmsEnrolment: 'lmsDb',
  LmsLiveSession: 'lmsDb',
  LmsSetting: 'lmsDb',
  LmsSyncJob: 'lmsDb',
  LmsWebhookEvent: 'lmsDb',
  MoodleObjectMap: 'lmsDb',
  MoodleUserMap: 'lmsDb',
  NotificationTemplate: 'lmsDb',
  Question: 'lmsDb',
  Quiz: 'lmsDb',
  QuizAttempt: 'lmsDb',
  Student: 'lmsDb',
  Ticket: 'lmsDb',

  // ---- financeDb ----
  Invoice: 'financeDb',
  Payment: 'financeDb',
  PaymentRequest: 'financeDb',
  PaymentKyc: 'financeDb',

  // ---- hrmsDb ----
  Announcement: 'hrmsDb',
  Appraisal: 'hrmsDb',
  Candidate: 'hrmsDb',
  Employee: 'hrmsDb',
  ExitRecord: 'hrmsDb',
  ExpenseClaim: 'hrmsDb',
  Holiday: 'hrmsDb',
  HrAsset: 'hrmsDb',
  HrAttendance: 'hrmsDb',
  HrDocument: 'hrmsDb',
  HrOnboarding: 'hrmsDb',
  HrTicket: 'hrmsDb',
  LeaveRequest: 'hrmsDb',
  LoanAdvance: 'hrmsDb',
  LoginActivity: 'hrmsDb',
  Payslip: 'hrmsDb',
  Recognition: 'hrmsDb',
  Shift: 'hrmsDb',
  ShiftRoster: 'hrmsDb',
  Timesheet: 'hrmsDb',
  TrainingProgram: 'hrmsDb',

  // ---- operationDb ----
  AgentCallState: 'operationDb',
  Approval: 'operationDb',
  Call: 'operationDb',
  CallCallback: 'operationDb',
  CallCampaign: 'operationDb',
  CallLead: 'operationDb',
  CallRecord: 'operationDb',
  GitConnection: 'operationDb',
  IvrFlow: 'operationDb',
  Message: 'operationDb',
  MessengerBroadcast: 'operationDb',
  MessengerContact: 'operationDb',
  MessengerConversation: 'operationDb',
  Notification: 'operationDb',
  OpsDelivery: 'operationDb',
  OpsDocument: 'operationDb',
  OpsProject: 'operationDb',
  Vendor: 'operationDb',
  VercelConnection: 'operationDb',

  // ---- coreDb (shared / auth) ----
  Admin: 'coreDb',
  AdminPassword: 'coreDb',
  Setting: 'coreDb',
  Team: 'coreDb',
  Permission: 'coreDb',
};

const dbConnections = new Map(); // dbName -> cached useDb() Connection

function getDbNameForModel(modelName) {
  const dbName = DB_MAP[modelName];
  if (!dbName) {
    // Fail LOUD and at boot (registration time), not silently at request
    // time — a model missing from DB_MAP would otherwise register on
    // whichever database it happens to touch first, exactly the kind of
    // silent misrouting this map exists to prevent.
    throw new Error(
      `[multiDb] Model "${modelName}" is not present in DB_MAP ` +
        `(backend/src/config/multiDb.js). Every model must be explicitly ` +
        `assigned to one of the 7 databases before it can be registered or ` +
        `looked up — add it to DB_MAP and restart the server.`
    );
  }
  return dbName;
}

function getConnectionForModel(modelName) {
  const dbName = getDbNameForModel(modelName);
  let conn = dbConnections.get(dbName);
  if (!conn) {
    conn = mongoose.connection.useDb(dbName, { useCache: true });
    dbConnections.set(dbName, conn);
  }
  return conn;
}

let patched = false;

function installMultiDbRouting() {
  if (patched) return; // idempotent: both server.js and api/index.js call this
  patched = true;

  const originalModel = mongoose.model.bind(mongoose);

  mongoose.model = function patchedModel(name, schema, collection, options) {
    // Only intercept the exact shape this codebase uses: a string model
    // name, looked up alone or registered with a schema. Anything else
    // (e.g. the rare class-based `mongoose.model(SomeClass)` form) falls
    // through to normal Mongoose behavior unchanged.
    if (typeof name !== 'string') {
      return originalModel(name, schema, collection, options);
    }

    const conn = getConnectionForModel(name);

    if (arguments.length === 1) {
      // Lookup-only: mongoose.model('Lead') — used by every controller and
      // by createCRUDController. Resolve from Lead's own database
      // connection's registry, not the (now-unused) default connection's.
      return conn.model(name);
    }

    // Registration: mongoose.model('Lead', schema) — called once per model
    // file at require-time inside the glob loop in server.js / api/index.js.
    return conn.model(name, schema, collection, options);
  };
}

module.exports = { installMultiDbRouting, getConnectionForModel, getDbNameForModel, DB_MAP };
