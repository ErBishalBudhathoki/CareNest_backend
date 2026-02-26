const express = require('express');
const router = express.Router();
const clientPortalController = require('../controllers/clientPortalController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

// Appointments
router.get('/appointments', clientPortalController.getAppointments);
router.get(
  '/appointments/:assignmentId/:scheduleId',
  clientPortalController.getAppointmentDetail
);
router.post('/appointments/request', clientPortalController.requestAppointment);

// Invoices
router.get('/invoices', clientPortalController.getInvoices);
router.get('/invoices/:id', clientPortalController.getInvoiceDetail);
router.post('/invoices/:id/approve', clientPortalController.approveInvoice);
router.post('/invoices/:id/dispute', clientPortalController.disputeInvoice);

// Backward-compatible singular aliases
router.get('/appointment/:assignmentId/:scheduleId', clientPortalController.getAppointmentDetail);
router.get('/invoice/:id', clientPortalController.getInvoiceDetail);
router.post('/invoice/:id/approve', clientPortalController.approveInvoice);
router.post('/invoice/:id/dispute', clientPortalController.disputeInvoice);
router.post('/appointment/request', clientPortalController.requestAppointment);

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
router.get('/feedback-feed', clientPortalController.getFeedbackFeed);

// Get service history
router.get('/service-history/:clientId', clientPortalController.getServiceHistory);

module.exports = router;
