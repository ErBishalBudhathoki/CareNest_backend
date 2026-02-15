const express = require('express');
const router = express.Router();
const schedulingController = require('../controllers/schedulingController');

// Shift Matching Routes
router.post('/match-workers', schedulingController.matchWorkers);
router.post('/auto-fill', schedulingController.autoFillShifts);
router.post('/optimize-route', schedulingController.optimizeRoute);
router.get('/recommendations/:shiftId', schedulingController.getShiftRecommendations);

module.exports = router;
