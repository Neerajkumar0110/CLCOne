const express = require('express');
const { catchErrors } = require('../../../handlers/errorHandlers');
const payments = require('../../../controllers/appControllers/payments/paymentsController');

// Mounted at /api/payments, behind adminAuth.isValidAuthToken (see app.js) —
// req.admin is always set here.
const router = express.Router();

router.route('/').get(catchErrors(payments.list)).post(catchErrors(payments.create));
router.route('/:id').get(catchErrors(payments.get));
router.route('/:id/resend').post(catchErrors(payments.resend));
router.route('/:id/refresh').post(catchErrors(payments.refreshStatus));

module.exports = router;
