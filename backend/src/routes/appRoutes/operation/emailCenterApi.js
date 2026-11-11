const express = require('express');

const { catchErrors } = require('../../../handlers/errorHandlers');
const c = require('../../../controllers/appControllers/operation/emailCenterController');

// Messenger › Email (Email centre). Mounted at /api/email-center behind
// adminAuth.isValidAuthToken (app.js); every handler is admin-only.
const router = express.Router();

router.route('/').get(catchErrors(c.list));
router.route('/custom').post(catchErrors(c.createCustom));
router.route('/preview').post(catchErrors(c.preview));
router.route('/item/:key').get(catchErrors(c.item)).put(catchErrors(c.save)).delete(catchErrors(c.removeCustom));
router.route('/item/:key/reset').post(catchErrors(c.reset));
router.route('/item/:key/test').post(catchErrors(c.test));

module.exports = router;
