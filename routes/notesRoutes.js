const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const { validationResult } = require('express-validator');
const notesController = require('../controllers/notesController');
const { authenticateUser } = require('../middleware/auth');

// Rate limiting
const notesReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many notes read requests.' }
});

const notesWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
  message: { success: false, code: 'RATE_LIMIT_EXCEEDED', message: 'Too many notes write requests.' }
});

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.param, message: e.msg }))
    });
  }
  next();
};

// Email validation regex
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validation chains
const addNoteValidation = [
  body('userEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid userEmail is required'),
  body('clientEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid clientEmail is required'),
  body('notes')
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('Notes must be between 1 and 5000 characters')
];

const getNotesValidation = [
  param('clientEmail')
    .trim()
    .matches(emailRegex)
    .withMessage('Valid clientEmail is required'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
];

const updateNoteValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid note ID format'),
  body('notes')
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('Notes must be between 1 and 5000 characters')
];

const deleteNoteValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid note ID format')
];

// Apply authentication middleware to all routes
router.use(authenticateUser);

/**
 * @route POST /api/notes
 * @desc Add a note for a client
 * @access Private
 */
router.post('/', notesWriteLimiter, addNoteValidation, handleValidationErrors, notesController.addNote);

/**
 * @route GET /api/notes/:clientEmail
 * @desc Get notes for a client
 * @access Private
 */
router.get('/:clientEmail', notesReadLimiter, getNotesValidation, handleValidationErrors, notesController.getNotes);

/**
 * @route PUT /api/notes/:id
 * @desc Update a note
 * @access Private
 */
router.put('/:id', notesWriteLimiter, updateNoteValidation, handleValidationErrors, notesController.updateNote);

/**
 * @route DELETE /api/notes/:id
 * @desc Delete a note
 * @access Private
 */
router.delete('/:id', notesWriteLimiter, deleteNoteValidation, handleValidationErrors, notesController.deleteNote);

module.exports = router;
