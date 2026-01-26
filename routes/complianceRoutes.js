const express = require('express');
const router = express.Router();
const complianceController = require('../controllers/complianceController');
const { protect } = require('../middleware/auth');

router.get('/summary', protect, complianceController.getSummary);

module.exports = router;
