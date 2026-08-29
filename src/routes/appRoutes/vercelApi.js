const express = require('express');
const router = express.Router();

const { catchErrors } = require('../../handlers/errorHandlers');
const controller = require('../../controllers/appControllers/vercelConnectionController');

// Mounted at /api/vercel with adminAuth.isValidAuthToken already applied
// (see app.js) — every route here requires a logged-in admin. The OAuth
// callback is NOT here; it's public and lives in corePublicRouter.js —
// mirrors gitApi.js exactly.

router.route('/connect').get(catchErrors(controller.connect));
router.route('/connection').get(catchErrors(controller.getConnection));
router.route('/connection').delete(catchErrors(controller.disconnectConnection));

router.route('/projects').get(catchErrors(controller.listProjects));
router.route('/projects').post(catchErrors(controller.createProject));
router.route('/projects/:idOrName').get(catchErrors(controller.getProject));

router.route('/projects/:idOrName/deployments').get(catchErrors(controller.listDeployments));
router.route('/projects/:idOrName/deploy').post(catchErrors(controller.deployLatest));
router.route('/projects/:idOrName/rollback/:deploymentId').post(catchErrors(controller.rollback));

router.route('/projects/:idOrName/env').get(catchErrors(controller.listEnvVars));
router.route('/projects/:idOrName/env').post(catchErrors(controller.createEnvVar));
router.route('/projects/:idOrName/env/:envId').patch(catchErrors(controller.updateEnvVar));
router.route('/projects/:idOrName/env/:envId').delete(catchErrors(controller.deleteEnvVar));

router.route('/projects/:idOrName/domains').get(catchErrors(controller.listDomains));
router.route('/projects/:idOrName/domains').post(catchErrors(controller.addDomain));
router.route('/projects/:idOrName/domains/:domain').delete(catchErrors(controller.removeDomain));

router.route('/deployments/:id').get(catchErrors(controller.getDeployment));
router.route('/deployments/:id/logs').get(catchErrors(controller.getBuildLogs));
router.route('/deployments/:id/redeploy').post(catchErrors(controller.redeploy));
router.route('/deployments/:id/cancel').post(catchErrors(controller.cancelDeployment));

module.exports = router;
