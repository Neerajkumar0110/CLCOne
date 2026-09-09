// Public surface of the LMS integration layer. Controllers and jobs import
// from here, never from the individual files, so the internal shape can move.
const { lmsConfig, publicLmsConfig } = require('../../config/lms');
const { getMoodleClient, MoodleError } = require('./MoodleClient');
const syncService = require('./syncService');
const queue = require('./queue');
const roleMap = require('./roleMap');
const sso = require('./ssoToken');
const liveClassService = require('./liveClassService');
const settingsService = require('./settingsService');
const recurrence = require('./recurrence');
const { getMeetingProvider } = require('./meeting');

module.exports = {
  lmsConfig,
  publicLmsConfig,
  getMoodleClient,
  MoodleError,
  syncService,
  queue,
  roleMap,
  sso,
  liveClassService,
  settingsService,
  recurrence,
  getMeetingProvider,
};
