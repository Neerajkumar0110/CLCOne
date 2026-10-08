const express = require('express');
const router = express.Router();

const { catchErrors } = require('../../../handlers/errorHandlers');
const { singleStorageUpload } = require('../../../middlewares/uploadMiddleware');
const controller = require('../../../controllers/appControllers/marketing/adTemplateController');

// Mounted at /api/marketing/ad-templates with adminAuth.isValidAuthToken
// already applied (see app.js). Manager-gating happens inside the
// controller (reading is open to any admin, writing is manager-only).
router.route('/').get(catchErrors(controller.list));
router.route('/:platform').patch(catchErrors(controller.upsert));
router
  .route('/:platform/media')
  .post(singleStorageUpload({ entity: 'adtemplate', fileType: 'default' }), catchErrors(controller.uploadMedia));

module.exports = router;
