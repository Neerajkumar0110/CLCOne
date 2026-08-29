let app;
let bootError;

try {
  const path = require('path');
  const mongoose = require('mongoose');

  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

  if (mongoose.connection.readyState === 0) {
    mongoose.connect(process.env.DATABASE);
  }

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
  ? app
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
