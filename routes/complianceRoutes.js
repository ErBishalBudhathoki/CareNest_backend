const express = require('express');
const router = express.Router();
const complianceController = require('../controllers/complianceController');
const { authenticateUser } = require('../middleware/auth');

router.get('/summary', authenticateUser, complianceController.getSummary);

module.exports = router;
