const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const silController = require('../controllers/silController');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const { requireEntitlement } = require('../middleware/billing/requireEntitlement');

const silReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many SIL read requests.' },
});
const silWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many SIL write requests.' },
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

// SIL management is an admin surface: the dashboard, roster builder and
// quoting screens only exist on the Admin dashboard. The role check is
// enforced here (not just in navigation) so a non-admin token cannot reach
// properties, ratios, rosters, quotes or rosters-of-care directly.
router.use(authenticateUser);
router.use(requireRoles(['admin']));
router.use(requireEntitlement('sil'));

// ---- Properties ----
router.get('/properties', silReadLimiter, silController.listProperties);
router.post(
  '/properties',
  silWriteLimiter,
  [body('name').trim().isLength({ min: 1, max: 160 }).withMessage('name is required')],
  handleValidationErrors,
  silController.createProperty,
);
router.get('/properties/:id/vacancies', silReadLimiter, mongoId('id'), handleValidationErrors, silController.getVacancies);
router.get('/properties/:id', silReadLimiter, mongoId('id'), handleValidationErrors, silController.getProperty);
router.put('/properties/:id', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.updateProperty);
router.delete('/properties/:id', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.deleteProperty);

// ---- Occupancy ----
router.get('/occupancy', silReadLimiter, silController.listOccupancy);
router.post(
  '/occupancy',
  silWriteLimiter,
  [
    mongoId('propertyId', body),
    mongoId('clientId', body),
    body('roomId').trim().isLength({ min: 1 }).withMessage('roomId is required'),
  ],
  handleValidationErrors,
  silController.createOccupancy,
);
router.put('/occupancy/:id', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.endOccupancy);

// ---- Ratio rules ----
router.get('/ratio-rules', silReadLimiter, silController.listRatioRules);
router.post(
  '/ratio-rules',
  silWriteLimiter,
  [body('name').trim().isLength({ min: 1 }).withMessage('name is required')],
  handleValidationErrors,
  silController.createRatioRule,
);
router.put('/ratio-rules/:id', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.updateRatioRule);
router.delete('/ratio-rules/:id', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.deleteRatioRule);

// ---- Rosters ----
router.get(
  '/rosters',
  silReadLimiter,
  [mongoId('propertyId', query), query('weekStarting').notEmpty().withMessage('weekStarting is required')],
  handleValidationErrors,
  silController.getRoster,
);
router.post(
  '/rosters',
  silWriteLimiter,
  [mongoId('propertyId', body), body('weekStarting').notEmpty().withMessage('weekStarting is required')],
  handleValidationErrors,
  silController.buildRoster,
);
router.put('/rosters/:id', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.updateRoster);
router.post('/rosters/:id/publish', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.publishRoster);
router.get('/rosters/:id/compliance', silReadLimiter, mongoId('id'), handleValidationErrors, silController.getRosterCompliance);

// ---- Quotes ----
router.get('/quotes', silReadLimiter, silController.listQuotes);
router.post(
  '/quotes',
  silWriteLimiter,
  [mongoId('clientId', body), body('lines').isArray({ min: 1 }).withMessage('lines are required')],
  handleValidationErrors,
  silController.createQuote,
);
router.get('/quotes/:id', silReadLimiter, mongoId('id'), handleValidationErrors, silController.getQuote);
router.put('/quotes/:id', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.updateQuote);
router.post('/quotes/:id/send', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.sendQuote);
router.post('/quotes/:id/accept', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.acceptQuote);
router.post('/quotes/:id/decline', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.declineQuote);
router.post('/quotes/:id/convert', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.convertQuote);

// ---- Rosters of care ----
router.get('/rosters-of-care', silReadLimiter, silController.listRostersOfCare);
router.get('/rosters-of-care/:id', silReadLimiter, mongoId('id'), handleValidationErrors, silController.getRosterOfCare);
router.put('/rosters-of-care/:id', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.updateRosterOfCare);
router.post('/rosters-of-care/:id/review', silWriteLimiter, mongoId('id'), handleValidationErrors, silController.reviewRosterOfCare);
router.post(
  '/rosters-of-care/:id/invoice',
  silWriteLimiter,
  [
    mongoId('id'),
    body('from').notEmpty().withMessage('from is required'),
    body('to').notEmpty().withMessage('to is required'),
  ],
  handleValidationErrors,
  silController.generateRosterOfCareInvoice,
);

module.exports = router;
