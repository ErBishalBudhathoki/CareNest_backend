const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const ndisClaimController = require('../controllers/ndisClaimController');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const { requireEntitlement } = require('../middleware/billing/requireEntitlement');

const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many claim read requests.' },
});
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many claim write requests.' },
});

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: errors.array().map((e) => ({ field: e.param, message: e.msg })),
    });
  }
  next();
};

// NDIS claiming (BPR export + results import) is an admin surface, reached
// only from the Admin dashboard. Enforce the role in the API as well so a
// non-admin token cannot generate a batch or import a results file.
router.use(authenticateUser);
router.use(requireRoles(['admin']));
router.use(requireEntitlement('ndis_claiming'));

router.get('/batches', readLimiter, ndisClaimController.listBatches);
router.post(
  '/generate',
  writeLimiter,
  [
    body('from').notEmpty().withMessage('from is required'),
    body('to').notEmpty().withMessage('to is required'),
  ],
  handleValidationErrors,
  ndisClaimController.generateBatch,
);
router.get('/batches/:id', readLimiter, param('id').isMongoId(), handleValidationErrors, ndisClaimController.getBatch);
router.post(
  '/batches/:id/results/import',
  writeLimiter,
  param('id').isMongoId(),
  handleValidationErrors,
  ndisClaimController.importResults,
);

module.exports = router;
