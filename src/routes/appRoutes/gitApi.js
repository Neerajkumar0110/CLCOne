const express = require('express');
const router = express.Router();

const { catchErrors } = require('@/handlers/errorHandlers');
const controller = require('@/controllers/appControllers/gitConnectionController');

// Mounted at /api/git with adminAuth.isValidAuthToken already applied (see
// app.js) — every route here requires a logged-in admin. The OAuth callback
// is NOT here; it's public (no bearer token arrives on that request) and
// lives in corePublicRouter.js instead — mirrors googleApi.js exactly.

router.route('/connect').get(catchErrors(controller.connect));
router.route('/connection').get(catchErrors(controller.getConnection));
router.route('/connection').delete(catchErrors(controller.disconnectConnection));

router.route('/repos').get(catchErrors(controller.listMyRepos));
router.route('/repos').post(catchErrors(controller.createRepo));
router.route('/repos/all').get(catchErrors(controller.listAllRepos));

router.route('/repos/:owner/:repo').get(catchErrors(controller.getRepoDetail));
router.route('/repos/:owner/:repo/branches').get(catchErrors(controller.listBranches));
router.route('/repos/:owner/:repo/commits').get(catchErrors(controller.listCommits));
router.route('/repos/:owner/:repo/pulls').get(catchErrors(controller.listPulls));
router.route('/repos/:owner/:repo/issues').get(catchErrors(controller.listIssues));
router.route('/repos/:owner/:repo/releases').get(catchErrors(controller.listReleases));
router.route('/repos/:owner/:repo/activity').get(catchErrors(controller.listActivity));

module.exports = router;
