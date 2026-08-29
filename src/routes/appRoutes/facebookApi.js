const express = require('express');
const router = express.Router();

const { catchErrors } = require('../../handlers/errorHandlers');
const { singleStorageUpload } = require('../../middlewares/uploadMiddleware');
const controller = require('../../controllers/appControllers/facebookController');

// Mounted at /api/facebook with adminAuth.isValidAuthToken already applied
// (see app.js) — every route here requires a logged-in admin. The OAuth
// callback and the leadgen webhook are NOT here; they're public (no bearer
// token arrives on those requests) and live in corePublicRouter.js instead.

router.route('/connect').get(catchErrors(controller.connect));
router.route('/connection').get(catchErrors(controller.getConnection));
router.route('/connection').patch(catchErrors(controller.updateConnection));
router.route('/connection').delete(catchErrors(controller.disconnectConnection));

router.route('/pages').get(catchErrors(controller.getPages));
router.route('/ad-accounts').get(catchErrors(controller.getAdAccounts));

router.route('/forms').get(catchErrors(controller.getForms));
router.route('/forms').post(catchErrors(controller.createForm));

router.route('/campaigns').get(catchErrors(controller.listCampaigns));
router.route('/campaigns').post(catchErrors(controller.createCampaign));
router.route('/campaigns/:id').get(catchErrors(controller.readCampaign));
router.route('/campaigns/:id').patch(catchErrors(controller.updateCampaign));
router.route('/campaigns/:id/publish').post(catchErrors(controller.publishCampaign));

router.route('/adsets').get(catchErrors(controller.listAdSets));
router.route('/adsets').post(catchErrors(controller.createAdSet));
router.route('/adsets/:id').patch(catchErrors(controller.updateAdSet));

router.route('/creatives').get(catchErrors(controller.listCreatives));
router
  .route('/creatives')
  .post(singleStorageUpload({ entity: 'adcreative', fileType: 'default' }), catchErrors(controller.createCreative));

router.route('/ads').get(catchErrors(controller.listAds));
router.route('/ads').post(catchErrors(controller.createAd));
router.route('/ads/:id').patch(catchErrors(controller.updateAd));
router.route('/ads/:id/publish').post(catchErrors(controller.publishAd));

module.exports = router;
