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
  // (e.g. Vercel's serverless build) include all of them.
  require('../src/models/appModels/Call');
  require('../src/models/appModels/CaptureFormConfig');
  require('../src/models/appModels/Client');
  require('../src/models/appModels/FacebookAd');
  require('../src/models/appModels/FacebookAdCreative');
  require('../src/models/appModels/FacebookAdSet');
  require('../src/models/appModels/FacebookCampaign');
  require('../src/models/appModels/FacebookConnection');
  require('../src/models/appModels/FacebookWebhookLog');
  require('../src/models/appModels/GitConnection');
  require('../src/models/appModels/GoogleAd');
  require('../src/models/appModels/GoogleAdGroup');
  require('../src/models/appModels/GoogleCampaign');
  require('../src/models/appModels/GoogleConnection');
  require('../src/models/appModels/GoogleWebhookLog');
  require('../src/models/appModels/Invoice');
  require('../src/models/appModels/Lead');
  require('../src/models/appModels/LeadImportBatch');
  require('../src/models/appModels/LinkedInCampaign');
  require('../src/models/appModels/LinkedInCampaignGroup');
  require('../src/models/appModels/LinkedInConnection');
  require('../src/models/appModels/LinkedInCreative');
  require('../src/models/appModels/LinkedInLeadSyncLog');
  require('../src/models/appModels/LoginActivity');
  require('../src/models/appModels/Message');
  require('../src/models/appModels/Notification');
  require('../src/models/appModels/Payment');
  require('../src/models/appModels/Permission');
  require('../src/models/appModels/Shift');
  require('../src/models/appModels/Team');
  require('../src/models/appModels/Ticket');
  require('../src/models/appModels/VercelConnection');
  require('../src/models/coreModels/Admin');
  require('../src/models/coreModels/AdminPassword');
  require('../src/models/coreModels/Setting');
  require('../src/models/coreModels/Upload');

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
