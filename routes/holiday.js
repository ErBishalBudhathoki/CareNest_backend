const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const { authenticateUser, requireRoles } = require('../middleware/auth');
const holidayController = require('../controllers/holidayController');
const router = express.Router();

// Rate limiting
const holidayLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Too many holiday requests.' }
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { success: false, message: 'Too many requests.' }
});

const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many admin requests.' }
});

// Validation rules
const addHolidayValidation = [
    body('Holiday').trim().notEmpty().withMessage('Holiday name is required'),
    body('Holiday').isLength({ max: 200 }).withMessage('Holiday name too long'),
    body('Date').isISO8601().withMessage('Valid date is required'),
    body('Day').optional().trim().isLength({ max: 50 }),
    body('state').optional().trim().isLength({ max: 50 }),
    body('type').optional().isIn(['public', 'school', 'observance']).withMessage('Type must be public, school, or observance')
];

const deleteHolidayValidation = [
    param('id').isMongoId().withMessage('Valid holiday ID is required')
];

const checkHolidaysValidation = [
    body('dateList').trim().notEmpty().withMessage('Date list is required'),
    body('state').optional().trim().isLength({ max: 50 })
];

// Public routes - get holidays
router.get("/getHolidays", holidayLimiter, holidayController.getAllHolidays);

// Protected admin routes
router.use(authenticateUser);
router.use(requireRoles(['admin']));

/**
 * Upload CSV data from GitHub to MongoDB
 * Fetches holiday data from a remote CSV file and stores it in the database
 * POST /uploadCSV
 */
router.post("/uploadCSV", adminLimiter, holidayController.uploadCSV);

/**
 * Delete a holiday by ID
 * DELETE /deleteHoliday/:id
 * @param {string} id - MongoDB ObjectId of the holiday to delete
 */
router.delete("/deleteHoliday/:id", strictLimiter, deleteHolidayValidation, handleValidationErrors, holidayController.deleteHoliday);

/**
 * Add a new holiday
 * POST /addHolidayItem
 * @param {object} req.body - Holiday data (Holiday, Date, Day)
 */
router.post("/addHolidayItem", strictLimiter, addHolidayValidation, handleValidationErrors, holidayController.addHoliday);

/**
 * Check if dates are holidays
 * POST /check-holidays
 * @param {string} req.body.dateList - Comma-separated list of dates to check
 * @returns {Array} Array of "Holiday" or "No Holiday" for each date
 */
router.post("/check-holidays", holidayLimiter, checkHolidaysValidation, handleValidationErrors, holidayController.checkHolidays);

module.exports = router;
