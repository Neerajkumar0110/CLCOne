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

// PUBLIC — DeroPo's incoming-message webhook, guarded by the secret in the path.
const publicRouter = express.Router();
publicRouter.route('/:secret').post(catchErrors(webhook.incoming));

module.exports = { router, publicRouter };
