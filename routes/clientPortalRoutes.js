const express = require('express');
const router = express.Router();
const clientPortalController = require('../controllers/clientPortalController');
const { authenticateUser, requireRoles } = require('../middleware/auth');

// Public routes
router.post('/auth/activate', clientPortalController.activate);
router.post('/auth/login', clientPortalController.login);

// Protected routes (Require Client Role)
router.use(authenticateUser);
router.use(requireRoles(['client']));

// Invoices
router.get('/invoices', clientPortalController.getInvoices);
router.get('/invoices/:id', clientPortalController.getInvoiceDetail);
router.post('/invoices/:id/approve', clientPortalController.approveInvoice);
router.post('/invoices/:id/dispute', clientPortalController.disputeInvoice);

// Appointments
router.get('/appointments', clientPortalController.getAppointments);
router.post('/appointments/request', clientPortalController.requestAppointment);

// Account
router.post('/auth/change-password', clientPortalController.changePassword);

module.exports = router;
