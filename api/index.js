let app;
let bootError;

try {
  require('module-alias/register');
  const path = require('path');
  const mongoose = require('mongoose');
  const { globSync } = require('glob');

  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

  if (mongoose.connection.readyState === 0) {
    mongoose.connect(process.env.DATABASE);
  }

  mongoose.connection.on('error', (error) => {
    console.error(`MongoDB connection error: ${error.message}`);
  });

  const modelsFiles = globSync(path.join(__dirname, '../src/models/**/*.js').split(path.sep).join('/'));
  for (const filePath of modelsFiles) {
    require(path.resolve(filePath));
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
