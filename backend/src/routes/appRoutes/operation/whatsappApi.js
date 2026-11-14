const express = require('express');

const { catchErrors } = require('../../../handlers/errorHandlers');
const controller = require('../../../controllers/appControllers/operation/whatsappController');
const webhook = require('../../../controllers/appControllers/operation/whatsappController/webhook');

// Mounted at /api/whatsapp with adminAuth.isValidAuthToken applied (app.js).
// Access is checked inside each handler (services/whatsapp/access.js).
const router = express.Router();

router.route('/me').get(catchErrors(controller.me));

router.route('/device').post(catchErrors(controller.createDevice));
router.route('/device').delete(catchErrors(controller.removeDevice));
router.route('/device/qr').get(catchErrors(controller.deviceQr));
router.route('/device/status').get(catchErrors(controller.deviceStatus));

router.route('/chats').get(catchErrors(controller.listChats));
router.route('/chats').post(catchErrors(controller.openChat));
router.route('/chats/:id/messages').get(catchErrors(controller.chatMessages));
router.route('/chats/:id/read').post(catchErrors(controller.markRead));
router.route('/chats/:id/send').post(catchErrors(controller.send));

router.route('/admin/access').get(catchErrors(controller.getAccess));
router.route('/admin/access').put(catchErrors(controller.saveAccess));
router.route('/admin/devices/refresh').post(catchErrors(controller.refreshAllDevices));

router.route('/admin/webhook').get(catchErrors(controller.webhookInfo));

// Company (business) numbers — admin only
router.route('/admin/business').get(catchErrors(controller.listBusiness));
router.route('/admin/business').post(catchErrors(controller.createBusiness));
router.route('/admin/business/:id').patch(catchErrors(controller.renameBusiness));
router.route('/admin/business/:id').delete(catchErrors(controller.removeBusiness));
router.route('/admin/business/:id/qr').get(catchErrors(controller.businessQr));
router.route('/admin/business/:id/status').get(catchErrors(controller.businessStatus));
router.route('/admin/business/:id/relink').post(catchErrors(controller.relinkBusiness));
router.route('/admin/business/:id/chats').post(catchErrors(controller.openBusinessChat));

// PUBLIC — DeroPo's incoming-message webhook, guarded by the secret in the path.
const publicRouter = express.Router();
publicRouter.route('/:secret').post(catchErrors(webhook.incoming));

module.exports = { router, publicRouter };
