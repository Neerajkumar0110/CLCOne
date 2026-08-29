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

  // Registering each model by a literal require (rather than a glob +
  // dynamic require) so bundlers that statically trace dependencies
  // (e.g. Vercel's serverless build) include all of them. The result is
  // deliberately used (not just require()'d for its side effect) because
  // Vercel's build bundles with Rolldown, which lazily/tree-shakes plain
  // require() calls whose return value is discarded — that silently
  // skipped the mongoose.model() registration each file performs.
  const models = {
    Call: require('../src/models/appModels/Call'),
    CaptureFormConfig: require('../src/models/appModels/CaptureFormConfig'),
    Client: require('../src/models/appModels/Client'),
    FacebookAd: require('../src/models/appModels/FacebookAd'),
    FacebookAdCreative: require('../src/models/appModels/FacebookAdCreative'),
    FacebookAdSet: require('../src/models/appModels/FacebookAdSet'),
    FacebookCampaign: require('../src/models/appModels/FacebookCampaign'),
    FacebookConnection: require('../src/models/appModels/FacebookConnection'),
    FacebookWebhookLog: require('../src/models/appModels/FacebookWebhookLog'),
    GitConnection: require('../src/models/appModels/GitConnection'),
    GoogleAd: require('../src/models/appModels/GoogleAd'),
    GoogleAdGroup: require('../src/models/appModels/GoogleAdGroup'),
    GoogleCampaign: require('../src/models/appModels/GoogleCampaign'),
    GoogleConnection: require('../src/models/appModels/GoogleConnection'),
    GoogleWebhookLog: require('../src/models/appModels/GoogleWebhookLog'),
    Invoice: require('../src/models/appModels/Invoice'),
    Lead: require('../src/models/appModels/Lead'),
    LeadImportBatch: require('../src/models/appModels/LeadImportBatch'),
    LinkedInCampaign: require('../src/models/appModels/LinkedInCampaign'),
    LinkedInCampaignGroup: require('../src/models/appModels/LinkedInCampaignGroup'),
    LinkedInConnection: require('../src/models/appModels/LinkedInConnection'),
    LinkedInCreative: require('../src/models/appModels/LinkedInCreative'),
    LinkedInLeadSyncLog: require('../src/models/appModels/LinkedInLeadSyncLog'),
    LoginActivity: require('../src/models/appModels/LoginActivity'),
    Message: require('../src/models/appModels/Message'),
    Notification: require('../src/models/appModels/Notification'),
    Payment: require('../src/models/appModels/Payment'),
    Permission: require('../src/models/appModels/Permission'),
    Shift: require('../src/models/appModels/Shift'),
    Team: require('../src/models/appModels/Team'),
    Ticket: require('../src/models/appModels/Ticket'),
    VercelConnection: require('../src/models/appModels/VercelConnection'),
    Admin: require('../src/models/coreModels/Admin'),
    AdminPassword: require('../src/models/coreModels/AdminPassword'),
    Setting: require('../src/models/coreModels/Setting'),
    Upload: require('../src/models/coreModels/Upload'),
  };

  const unloaded = Object.entries(models).filter(([, model]) => !model);
  if (unloaded.length > 0) {
    throw new Error(`Failed to load models: ${unloaded.map(([name]) => name).join(', ')}`);
  }

  app = require('../src/app');
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
