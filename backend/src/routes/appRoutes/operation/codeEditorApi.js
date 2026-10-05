const express = require('express');
const router = express.Router();

const { catchErrors } = require('../../../handlers/errorHandlers');
const controller = require('../../../controllers/appControllers/operation/codeEditorController');

// Mounted at /api/code-editor with adminAuth.isValidAuthToken already
// applied (see app.js) — mirrors gitApi.js / vercelApi.js. The actual
// Code Editor permission grant is checked inside the controller itself
// (codeEditorAccess), not here — same pattern as every other module.
router.route('/session').post(catchErrors(controller.createSession));

module.exports = router;
