const express = require('express');
const { catchErrors } = require('../../../handlers/errorHandlers');
const payments = require('../../../controllers/appControllers/payments/paymentsController');

// Mounted at /api/payments, behind adminAuth.isValidAuthToken (see app.js) —
// req.admin is always set here.
const router = express.Router();

router.route('/').get(catchErrors(payments.list)).post(catchErrors(payments.create));
// Must come before '/:id' — otherwise Express would match "course-fee"/"stats"/"roster" as an :id.
router.route('/course-fee').get(catchErrors(payments.courseFee));
router.route('/stats').get(catchErrors(payments.stats));
router.route('/roster').get(catchErrors(payments.roster));
// Finance (EMI via finance partner) applications — see paymentsController/finance.js.
router.route('/finance').get(catchErrors(payments.financeList)).post(catchErrors(payments.financeCreate));
router.route('/finance/:id').get(catchErrors(payments.financeGet));
router.route('/finance/:id/resend').post(catchErrors(payments.financeResend));
router.route('/:id').get(catchErrors(payments.get));
router.route('/:id/resend').post(catchErrors(payments.resend));
router.route('/:id/refresh').post(catchErrors(payments.refreshStatus));
router.route('/:id/next-installment').post(catchErrors(payments.nextInstallment));

module.exports = router;
