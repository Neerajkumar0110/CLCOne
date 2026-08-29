const express = require('express');
const router = express.Router();

const { catchErrors } = require('@/handlers/errorHandlers');
const controller = require('@/controllers/appControllers/googleController');

// Mounted at /api/google with adminAuth.isValidAuthToken already applied
// (see app.js) — every route here requires a logged-in admin. The OAuth
// callback and the lead-form webhook are NOT here; they're public (no
// bearer token arrives on those requests) and live in corePublicRouter.js
// instead — mirrors facebookApi.js exactly.

router.route('/connect').get(catchErrors(controller.connect));
router.route('/connection').get(catchErrors(controller.getConnection));
router.route('/connection').patch(catchErrors(controller.updateConnection));
router.route('/connection').delete(catchErrors(controller.disconnectConnection));

router.route('/customer-accounts').get(catchErrors(controller.getCustomerAccounts));

router.route('/campaigns').get(catchErrors(controller.listCampaigns));
router.route('/campaigns').post(catchErrors(controller.createCampaign));
router.route('/campaigns/:id').get(catchErrors(controller.readCampaign));
router.route('/campaigns/:id').patch(catchErrors(controller.updateCampaign));
router.route('/campaigns/:id/publish').post(catchErrors(controller.publishCampaign));

router.route('/adgroups').get(catchErrors(controller.listAdGroups));
router.route('/adgroups').post(catchErrors(controller.createAdGroup));
router.route('/adgroups/:id').patch(catchErrors(controller.updateAdGroup));

router.route('/ads').get(catchErrors(controller.listAds));
router.route('/ads').post(catchErrors(controller.createAd));
router.route('/ads/:id').patch(catchErrors(controller.updateAd));
router.route('/ads/:id/publish').post(catchErrors(controller.publishAd));

module.exports = router;
