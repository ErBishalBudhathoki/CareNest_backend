const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, query } = require('express-validator');
const { authenticateUser } = require('../middleware/auth');
const {
  organizationContextMiddleware,
} = require('../middleware/organizationContext');
const { handleValidationErrors } = require('../middleware/validation');
const invoicingEmailController = require('../controllers/invoicingEmailController');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests.' },
});

router.use(authenticateUser, organizationContextMiddleware, limiter);

router.post(
  '/addUpdateInvoicingEmailDetail',
  [
    body('userEmail').isEmail().normalizeEmail().withMessage('Valid userEmail is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('encryptedPassword').trim().notEmpty().withMessage('encryptedPassword is required'),
    body('invoicingBusinessName').optional().trim(),
  ],
  handleValidationErrors,
  invoicingEmailController.addUpdateInvoicingEmailDetail
);

router.post(
  '/invoicingEmailDetailKey',
  [
    body('userEmail').isEmail().normalizeEmail().withMessage('Valid userEmail is required'),
    body('invoicingBusinessKey').trim().notEmpty().withMessage('invoicingBusinessKey is required'),
  ],
  handleValidationErrors,
  invoicingEmailController.setInvoicingEmailDetailKey
);

router.get(
  '/getInvoicingEmailDetails',
  [
    query('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  ],
  handleValidationErrors,
  invoicingEmailController.getInvoicingEmailDetails
);

router.get(
  '/checkInvoicingEmailKey',
  [
    query('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  ],
  handleValidationErrors,
  invoicingEmailController.checkInvoicingEmailKey
);

router.post(
  '/getEmailDetailToSendEmail',
  [
    body('userEmail').isEmail().normalizeEmail().withMessage('Valid userEmail is required'),
  ],
  handleValidationErrors,
  invoicingEmailController.getEmailDetailToSendEmail
);

module.exports = router;

