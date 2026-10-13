const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const stakeholderController = require('../controllers/stakeholderController');
const { authenticateUser } = require('../middleware/auth');

const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many stakeholder read requests.' },
});
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many stakeholder write requests.' },
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

const mongoId = (name, location = param) =>
  location(name).isMongoId().withMessage(`Invalid ${name}`);

router.use(authenticateUser);

// Care team for a client (declared before /:id to avoid shadowing).
router.get(
  '/clients/:clientId/care-team',
  readLimiter,
  mongoId('clientId'),
  handleValidationErrors,
  stakeholderController.getClientCareTeam,
);
router.post(
  '/clients/:clientId/stakeholders',
  writeLimiter,
  [mongoId('clientId'), mongoId('stakeholderId', body)],
  handleValidationErrors,
  stakeholderController.linkStakeholder,
);
router.delete(
  '/clients/:clientId/stakeholders/:stakeholderId',
  writeLimiter,
  [mongoId('clientId'), mongoId('stakeholderId')],
  handleValidationErrors,
  stakeholderController.unlinkStakeholder,
);

// Stakeholder CRUD.
router.get('/', readLimiter, stakeholderController.listStakeholders);
router.post(
  '/',
  writeLimiter,
  [
    body('name').trim().isLength({ min: 1, max: 160 }).withMessage('name is required'),
    body('type')
      .optional()
      .isIn(['plan_manager', 'support_coordinator', 'nominee', 'family', 'other'])
      .withMessage('Invalid stakeholder type'),
  ],
  handleValidationErrors,
  stakeholderController.createStakeholder,
);
router.get('/:id', readLimiter, mongoId('id'), handleValidationErrors, stakeholderController.getStakeholder);
router.put('/:id', writeLimiter, mongoId('id'), handleValidationErrors, stakeholderController.updateStakeholder);
router.delete('/:id', writeLimiter, mongoId('id'), handleValidationErrors, stakeholderController.deleteStakeholder);

module.exports = router;
