// Ported from python-test-platform (see plan doc / commit message for
// context). Barrel re-export, required from the parent lmsController/index.js
// and spread into its flat module.exports with an `assessment*`-prefixed key
// per function, matching that file's existing convention.
const test = require('./testController');
const admin = require('./adminController');
const curriculum = require('./curriculumController');
const proctor = require('./proctorController');

module.exports = {
  startTest: test.startTest,
  submitTest: test.submitTest,
  runCode: test.runCode,
  getMyResults: test.getMyResults,
  getAttemptBreakdown: test.getAttemptBreakdown,

  getAttempts: admin.getAttempts,
  getAttemptsExport: admin.getAttemptsExport,
  notAttemptedReport: admin.notAttemptedReport,
  getAttemptReport: admin.getAttemptReport,
  getSummary: admin.getSummary,
  getAssessmentSettings: admin.getAssessmentSettings,
  updateAssessmentSettings: admin.updateAssessmentSettings,
  correctAttempt: admin.correctAttempt,

  getSessions: curriculum.getSessions,
  updateDelivery: curriculum.updateDelivery,

  logProctorEvent: proctor.logProctorEvent,
};
