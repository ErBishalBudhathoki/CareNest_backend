const express = require('express');
const router = express.Router();
const ocrController = require('../controllers/ocrController');
const { authenticateUser } = require('../middleware/auth');

// Apply authentication middleware if needed
// router.use(authenticateUser);

/**
 * @route POST /api/ocr/parse
 * @desc Parse raw text from receipt OCR
 * @access Private
 */
router.post('/parse', ocrController.parseReceipt);

module.exports = router;
