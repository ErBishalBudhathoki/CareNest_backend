const express = require('express');
const router = express.Router();
const clientPortalController = require('../controllers/clientPortalController');

// Get client dashboard
router.get('/dashboard/:clientId', clientPortalController.getClientDashboard);

// Get worker location
router.get('/worker-location/:appointmentId', clientPortalController.getWorkerLocation);

// Get appointment status
router.get('/appointment-status/:appointmentId', clientPortalController.getAppointmentStatus);

// Send message
router.post('/message', clientPortalController.sendClientMessage);

// Submit feedback
router.post('/feedback', clientPortalController.submitServiceFeedback);

// Get service history
router.get('/service-history/:clientId', clientPortalController.getServiceHistory);

module.exports = router;
