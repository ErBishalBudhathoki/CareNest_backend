/**
 * Active Timers Routes
 * Express router for active timer management
 * 
 * @file backend/routes/v1/activeTimers.js
 */

const express = require('express');
const ActiveTimerController = require('../../controllers/activeTimerController');
const router = express.Router();

// Start a timer
// POST /api/active-timers/start
router.post('/start', ActiveTimerController.startTimer);

// Stop a timer
// POST /api/active-timers/stop
router.post('/stop', ActiveTimerController.stopTimer);

// Get active timers for an organization
// GET /api/active-timers/:organizationId
router.get('/:organizationId', ActiveTimerController.getActiveTimers);

module.exports = router;
