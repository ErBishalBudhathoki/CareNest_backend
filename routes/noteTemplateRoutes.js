const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const noteTemplateController = require('../controllers/noteTemplateController');
const { authenticateUser, requireRoles } = require('../middleware/auth');

const templateReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many template read requests.',
  },
});

const templateWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: {
    success: false,
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many template write requests.',
  },
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

const createValidation = [
  body('name').trim().isLength({ min: 1, max: 120 }).withMessage('name is required'),
  body('sections').optional().isArray().withMessage('sections must be an array'),
];

const updateValidation = [
  param('id').isMongoId().withMessage('Invalid template ID format'),
  body('name').optional().trim().isLength({ min: 1, max: 120 }),
  body('sections').optional().isArray(),
];

const idValidation = [param('id').isMongoId().withMessage('Invalid template ID format')];

router.use(authenticateUser);

// Reading is deliberately open to every member of the organisation: support
// workers pick a template in the note composer (`add_notes_view.dart`), and
// their token is not an admin token. Everything that changes a template is
// admin-only, matching the admin template manager screen.
const requireAdmin = requireRoles(['admin']);

router.get('/', templateReadLimiter, noteTemplateController.listTemplates);
router.post('/', requireAdmin, templateWriteLimiter, createValidation, handleValidationErrors, noteTemplateController.createTemplate);
router.get('/:id', templateReadLimiter, idValidation, handleValidationErrors, noteTemplateController.getTemplate);
router.put('/:id', requireAdmin, templateWriteLimiter, updateValidation, handleValidationErrors, noteTemplateController.updateTemplate);
router.delete('/:id', requireAdmin, templateWriteLimiter, idValidation, handleValidationErrors, noteTemplateController.deleteTemplate);

module.exports = router;
