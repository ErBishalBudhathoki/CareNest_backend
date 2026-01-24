const express = require('express');
const workedTimeController = require('../controllers/workedTimeController');
const router = express.Router();

/**
 * Get visit history for a specific client
 * GET /history/:clientId
 */
router.get('/history/:clientId', workedTimeController.getVisitHistory);

/**
 * Get recent visits for a user
 * GET /recent/:userEmail
 */
router.get('/recent/:userEmail', workedTimeController.getRecentVisits);

module.exports = router;
