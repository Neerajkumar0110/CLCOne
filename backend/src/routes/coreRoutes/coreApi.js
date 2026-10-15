const express = require('express');

const { catchErrors } = require('../../handlers/errorHandlers');

const router = express.Router();

const adminController = require('../../controllers/coreControllers/adminController');
const settingController = require('../../controllers/coreControllers/settingController');

const { singleStorageUpload } = require('../../middlewares/uploadMiddleware');
const path = require('path');
const { trimTransparentPng } = require('../../utils/trimTransparentPng');

// Crop dead transparent space off an uploaded logo before it is recorded.
// The logo slots are sized by CSS height, so a file with transparent bands
// baked around the artwork renders as a tiny logo in a correctly-sized box.
// See utils/trimTransparentPng.js. Best-effort: a failure here must never
// lose the upload, so the original file just stays as it was.
const trimUploadedLogo = (req, res, next) => {
  try {
    if (req.file && req.file.path) {
      const result = trimTransparentPng(path.resolve(process.cwd(), req.file.path));
      if (result.trimmed) {
        console.log(`[setting.upload] trimmed ${req.file.filename}: ${result.from} -> ${result.to}`);
      }
    }
  } catch (e) {
    console.error('[setting.upload] trim failed:', e.message);
  }
  next();
};

// //_______________________________ Admin management_______________________________

router.route('/admin/create').post(catchErrors(adminController.create));
router.route('/admin/list').get(catchErrors(adminController.list));
router.route('/admin/read/:id').get(catchErrors(adminController.read));
router.route('/admin/overview/:id').get(catchErrors(require('../../controllers/coreControllers/adminController/overview')));
router.route('/admin/update/:id').patch(catchErrors(adminController.update));
router.route('/admin/delete/:id').delete(catchErrors(adminController.delete));

router.route('/admin/password-update/:id').patch(catchErrors(adminController.updatePassword));

//_______________________________ Admin Profile _______________________________

router.route('/admin/profile/password').patch(catchErrors(adminController.updateProfilePassword));
router
  .route('/admin/profile/update')
  .patch(
    singleStorageUpload({ entity: 'admin', fieldName: 'photo', fileType: 'image' }),
    catchErrors(adminController.updateProfile)
  );

// //____________________________________________ API for Global Setting _________________

router.route('/setting/create').post(catchErrors(settingController.create));
router.route('/setting/read/:id').get(catchErrors(settingController.read));
router.route('/setting/update/:id').patch(catchErrors(settingController.update));
//router.route('/setting/delete/:id).delete(catchErrors(settingController.delete));
router.route('/setting/search').get(catchErrors(settingController.search));
router.route('/setting/list').get(catchErrors(settingController.list));
router.route('/setting/listAll').get(catchErrors(settingController.listAll));
router.route('/setting/filter').get(catchErrors(settingController.filter));
router
  .route('/setting/readBySettingKey/:settingKey')
  .get(catchErrors(settingController.readBySettingKey));
router.route('/setting/listBySettingKey').get(catchErrors(settingController.listBySettingKey));
router
  .route('/setting/updateBySettingKey/:settingKey?')
  .patch(catchErrors(settingController.updateBySettingKey));
router
  .route('/setting/upload/:settingKey?')
  // POST as well as PATCH: the frontend request helper posts, so the
  // Settings logo upload hit a route that only answered PATCH and 404-ed.
  .post(
    singleStorageUpload({ entity: 'setting', fieldName: 'settingValue', fileType: 'image' }),
    trimUploadedLogo,
    catchErrors(settingController.updateBySettingKey)
  )
  .patch(
    singleStorageUpload({ entity: 'setting', fieldName: 'settingValue', fileType: 'image' }),
    trimUploadedLogo,
    catchErrors(settingController.updateBySettingKey)
  );
router.route('/setting/updateManySetting').patch(catchErrors(settingController.updateManySetting));
module.exports = router;
