const express = require('express');
const { catchErrors } = require('../../handlers/errorHandlers');
const { singleStorageUpload } = require('../../middlewares/uploadMiddleware');
const c = require('../../controllers/appControllers/callingController');
const { requireTier } = require('../../controllers/appControllers/callingController/permissions');

// Mounted at /api/calling — behind adminAuth.isValidAuthToken (see app.js),
// so req.admin is always set. Per-action role gating via requireTier().
const router = express.Router();

// ── meta / status ──────────────────────────────────────────────────────
router.route('/status').get(catchErrors(c.status));
router.route('/meta').get(catchErrors(c.meta));
router.route('/dashboard').get(catchErrors(c.dashboard));

// ── campaigns ──────────────────────────────────────────────────────────
router.route('/campaigns').get(catchErrors(c.campaignList));
router.route('/campaigns').post(requireTier('manager'), catchErrors(c.campaignCreate));
router.route('/campaigns/:id').get(catchErrors(c.campaignRead));
router.route('/campaigns/:id').patch(requireTier('manager'), catchErrors(c.campaignUpdate));
router.route('/campaigns/:id').delete(requireTier('admin'), catchErrors(c.campaignRemove));
router.route('/campaigns/:id/action').post(requireTier('manager'), catchErrors(c.campaignAction));

// ── campaign leads ─────────────────────────────────────────────────────
router.route('/campaigns/:id/leads').get(catchErrors(c.leadList));
router.route('/campaigns/:id/leads').post(requireTier('manager'), catchErrors(c.leadCreate));
router
  .route('/campaigns/:id/leads/import')
  .post(
    requireTier('manager'),
    singleStorageUpload({ entity: 'calllead', fieldName: 'file', fileType: 'default' }),
    catchErrors(c.leadImport)
  );

// ── auto dialer ────────────────────────────────────────────────────────
router.route('/dialer/:campaignId').get(catchErrors(c.dialerState));
router.route('/dialer/:campaignId/presence').post(catchErrors(c.dialerPresence));
router.route('/dialer/:campaignId/dial-next').post(catchErrors(c.dialerDialNext));

// ── agent calling screen ───────────────────────────────────────────────
router.route('/agent/active').get(catchErrors(c.agentActive));
router.route('/agent/call/:id/answer').post(catchErrors(c.agentAnswer));
router.route('/agent/call/:id/hold').post(catchErrors(c.agentHold));
router.route('/agent/call/:id/mute').post(catchErrors(c.agentMute));
router.route('/agent/call/:id/note').post(catchErrors(c.agentNote));
router.route('/agent/call/:id/hangup').post(catchErrors(c.agentHangup));
router.route('/agent/call/:id/transfer').post(catchErrors(c.agentTransfer));
router.route('/agent/call/:id/disposition').post(catchErrors(c.agentDisposition));
router.route('/agent/call/:id/callback').post(catchErrors(c.agentScheduleCallback));

// ── click-to-call (device-originated, no server) ───────────────────────
router.route('/manual/dial').post(catchErrors(c.manualDial));
router.route('/manual/end/:id').post(catchErrors(c.manualEnd));

// ── history / callbacks / recordings / reports ─────────────────────────
router.route('/history').get(catchErrors(c.historyList));

router.route('/callbacks').get(catchErrors(c.callbackList));
router.route('/callbacks').post(catchErrors(c.callbackCreate));
router.route('/callbacks/:id').patch(catchErrors(c.callbackUpdate));

router.route('/recordings').get(catchErrors(c.recordingList));
router.route('/recordings/:id').get(catchErrors(c.recordingRead));
router.route('/recordings/:id/stream').get(catchErrors(c.recordingStream));

router.route('/reports').get(catchErrors(c.reportSummary));

module.exports = router;
