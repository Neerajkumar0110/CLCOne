const express = require('express');
const rateLimit = require('express-rate-limit');
const { catchErrors } = require('../../../handlers/errorHandlers');
const { singleStorageUpload } = require('../../../middlewares/uploadMiddleware');
const payments = require('../../../controllers/appControllers/payments/paymentsPublicController');

// Mounted at /api/payments/public — BEFORE the bearer gate in app.js. Every
// endpoint here is reached without a CRM login; the unguessable publicToken
// in the URL (and, for the return/callback route, Razorpay's own HMAC
// signature) is what stands in for auth. Rate-limited the same way the LMS
// live-class public router is.
const router = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

// Razorpay Payment Link callback_url — a plain browser redirect, GET only.
router.route('/return').get(limiter, catchErrors(payments.returnHandler));

router.route('/:token').get(limiter, catchErrors(payments.status));
router.route('/:token/upload').post(
  limiter,
  singleStorageUpload({ entity: 'paymentkyc', fieldName: 'file', fileType: 'image' }),
  catchErrors(payments.upload)
);
router.route('/:token/kyc').post(limiter, catchErrors(payments.submitKyc));

module.exports = router;
