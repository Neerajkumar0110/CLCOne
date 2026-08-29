const express = require('express');
const router = express.Router();

const { catchErrors } = require('../../handlers/errorHandlers');
const { singleStorageUpload } = require('../../middlewares/uploadMiddleware');
const controller = require('../../controllers/appControllers/linkedinController');

// Mounted at /api/linkedin with adminAuth.isValidAuthToken already applied
// (see app.js) — every route here requires a logged-in admin. The OAuth
// callback is NOT here; it's public (no bearer token arrives on that
// request) and lives in corePublicRouter.js instead — mirrors
// routes/appRoutes/facebookApi.js exactly. Unlike Facebook, there is no
// public webhook route to mirror: LinkedIn has no lead webhook, leads are
// pulled by jobs/linkedinLeadPoller.js instead (see leadSync.js).

router.route('/connect').get(catchErrors(controller.connect));
router.route('/connection').get(catchErrors(controller.getConnection));
router.route('/connection').patch(catchErrors(controller.updateConnection));
router.route('/connection').delete(catchErrors(controller.disconnectConnection));

router.route('/ad-accounts').get(catchErrors(controller.getAdAccounts));

router.route('/campaign-groups').get(catchErrors(controller.listCampaignGroups));
router.route('/campaign-groups').post(catchErrors(controller.createCampaignGroup));
router.route('/campaign-groups/:id').get(catchErrors(controller.readCampaignGroup));
router.route('/campaign-groups/:id').patch(catchErrors(controller.updateCampaignGroup));
router.route('/campaign-groups/:id/publish').post(catchErrors(controller.publishCampaignGroup));

router.route('/campaigns').get(catchErrors(controller.listCampaigns));
router.route('/campaigns').post(catchErrors(controller.createCampaign));
router.route('/campaigns/:id').patch(catchErrors(controller.updateCampaign));
router.route('/campaigns/:id/publish').post(catchErrors(controller.publishCampaign));

router.route('/creatives').get(catchErrors(controller.listCreatives));
router
  .route('/creatives')
  .post(singleStorageUpload({ entity: 'linkedincreative', fileType: 'default' }), catchErrors(controller.createCreative));
router.route('/creatives/:id').patch(catchErrors(controller.updateCreative));
router.route('/creatives/:id/publish').post(catchErrors(controller.publishCreative));

router.route('/lead-sync-logs').get(catchErrors(controller.getSyncLogs));
router.route('/lead-sync/trigger').post(catchErrors(controller.triggerSync));

module.exports = router;
