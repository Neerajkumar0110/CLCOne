const express = require('express');
const { catchErrors } = require('../../../handlers/errorHandlers');
const { singleStorageUpload } = require('../../../middlewares/uploadMiddleware');

// LMS Additional Requirements (Figma yKjb2ncoVnPG9Eqql6zwhI) — mounted at
// /api/lms/growth behind the LMS bearer gate. Each handler checks its own
// role (learner / mentor / support / admin / QA).
const router = express.Router();

// ── 1 · Learner 360° ──
const L = require('../../../controllers/appControllers/lms/lmsController/growth/learner360');
router.get('/360/:id', catchErrors(L.report));
router.get('/360/:id/pdf', catchErrors(L.pdf));
router.put('/profile/me', catchErrors(L.saveProfile));
router.post('/profile/me/resume', singleStorageUpload({ entity: 'resumes', fieldName: 'file', fileType: 'pdf' }), catchErrors(L.uploadResume));
router.post('/profile/me/photo', singleStorageUpload({ entity: 'profile-photos', fieldName: 'file', fileType: 'image' }), catchErrors(L.uploadPhoto));
router.get('/mentor/learners', catchErrors(L.mentorLearners));
router.get('/remarks/:id', catchErrors(L.listRemarks));
router.post('/remarks/:id', catchErrors(L.addRemark));
router.delete('/remarks/item/:remarkId', catchErrors(L.deleteRemark));
router.get('/config', catchErrors(L.getConfig));
router.put('/config', catchErrors(L.saveConfig));
router.get('/leaderboard', catchErrors(L.leaderboard));
router.get('/share/me', catchErrors(L.getShare));
router.put('/share/me', catchErrors(L.saveShare));
router.delete('/share/me', catchErrors(L.revokeShare));

// ── 2 · Project allocation & tracking ──
const PR = require('../../../controllers/appControllers/lms/lmsController/growth/projects');
router.get('/projects/meta', catchErrors(PR.meta));
router.get('/projects/briefs', catchErrors(PR.listBriefs));
router.post('/projects/briefs', catchErrors(PR.saveBrief));
router.get('/projects/briefs/:id', catchErrors(PR.getBrief));
router.put('/projects/briefs/:id', catchErrors(PR.saveBrief));
router.delete('/projects/briefs/:id', catchErrors(PR.archiveBrief));
router.post('/projects/upload', singleStorageUpload({ entity: 'project-files', fieldName: 'file', fileType: 'default' }), catchErrors(PR.uploadFile));
router.get('/projects/allocate/:briefId/candidates', catchErrors(PR.candidates));
router.post('/projects/allocate/:briefId', catchErrors(PR.allocateNow));
router.get('/projects/dashboard', catchErrors(PR.dashboard));
router.get('/projects/desk', catchErrors(PR.desk));
router.get('/projects/automation', catchErrors(PR.automation));
router.get('/projects/my', catchErrors(PR.myProjects));
router.put('/projects/my/:id/draft', catchErrors(PR.saveDraft));
router.post('/projects/my/:id/submit', catchErrors(PR.submit));
router.post('/projects/my/:id/extension', catchErrors(PR.requestExtension));
router.get('/projects/alloc/:id', catchErrors(PR.getAlloc));
router.post('/projects/alloc/:id/extension', catchErrors(PR.decideExtension));
router.post('/projects/alloc/:id/review', catchErrors(PR.review));
router.post('/projects/alloc/:id/override', catchErrors(PR.override));
router.post('/projects/alloc/:id/resubmit', catchErrors(PR.setResubmit));
router.post('/projects/alloc/:id/reallocate', catchErrors(PR.reallocate));
router.post('/projects/alloc/:id/remind', catchErrors(PR.remind));
router.post('/projects/alloc/:id/nudge', catchErrors(PR.nudge));
router.post('/projects/alloc/:id/notify-decision', catchErrors(PR.notifyDecision));
router.post('/projects/alloc/:id/realloc-request', catchErrors(PR.reallocRequest));

// ── 3 · Practice & engagement ──
const EN = require('../../../controllers/appControllers/lms/lmsController/growth/engagement');
router.get('/activity/config', catchErrors(EN.activityConfig));
router.post('/activity/beat', catchErrors(EN.beat));
router.post('/content/progress', catchErrors(EN.contentProgress));
router.get('/practice/me', catchErrors(EN.practice));
router.put('/practice/me', catchErrors(EN.savePractice));
router.get('/content/me', catchErrors(EN.contentMe));
router.get('/engagement/mentor', catchErrors(EN.mentorEngagement));
router.post('/engagement/alerts/:id/nudge', catchErrors(EN.nudgeLearner));
router.post('/engagement/alerts/:id/to-support', catchErrors(EN.toSupport));
router.post('/engagement/alerts/:id/resolve', catchErrors(EN.resolveAlert));
router.post('/engagement/learner/:learnerId/message', catchErrors(EN.messageLearner));
router.get('/engagement/outreach', catchErrors(EN.outreach));
router.get('/engagement/outreach/:id/learner', catchErrors(EN.outreachLearner));
router.post('/engagement/outreach/:id', catchErrors(EN.saveOutreach));
router.post('/engagement/outreach/:id/drop-risk', catchErrors(EN.dropRisk));
router.post('/engagement/outreach/:id/email', catchErrors(EN.outreachEmail));

// ── 4 · QA environment ──
const QA = require('../../../controllers/appControllers/lms/lmsController/growth/qa');
router.get('/flags/me', catchErrors(QA.myFlags));
router.get('/qa/overview', catchErrors(QA.overview));
router.post('/qa/releases', catchErrors(QA.createRelease));
router.post('/qa/releases/:id/:action', catchErrors(QA.releaseAction));
router.put('/qa/settings', catchErrors(QA.saveSettings));
router.get('/qa/accounts', catchErrors(QA.accounts));
router.post('/qa/accounts', catchErrors(QA.addAccount));
router.post('/qa/reset', catchErrors(QA.resetData));
router.get('/qa/runs', catchErrors(QA.runs));
router.post('/qa/runs', catchErrors(QA.startRun));
router.post('/qa/cases', catchErrors(QA.saveCase));
router.put('/qa/cases/:id', catchErrors(QA.saveCase));
router.get('/qa/bugs', catchErrors(QA.bugs));
router.post('/qa/bugs', catchErrors(QA.saveBug));
router.put('/qa/bugs/:id', catchErrors(QA.saveBug));
router.get('/qa/flags', catchErrors(QA.listFlags));
router.post('/qa/flags', catchErrors(QA.saveFlag));
router.put('/qa/flags/:id', catchErrors(QA.saveFlag));
router.get('/qa/logs', catchErrors(QA.logs));

module.exports = router;
