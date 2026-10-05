const express = require('express');
const router = express.Router();

const { catchErrors } = require('../../../handlers/errorHandlers');
const controller = require('../../../controllers/appControllers/operation/codeEditorController');

// Mounted at /api/code-editor BEFORE the bearer gate in app.js — mirrors
// lmsLivePublicApi.js. GET /auth is hit only by nginx's internal
// auth_request on the VPS (never directly by a browser); a raw iframe
// navigation can't carry a CRM bearer token, so this is the one endpoint
// that validates the one-time ticket / session cookie instead.
router.route('/auth').get(catchErrors(controller.authCheck));

module.exports = router;
