const express = require('express');
const router = express.Router();
const timesheetController = require('../controllers/timesheetController');
const { authenticateUser, requireRoles } = require('../middleware/auth');

// Protected routes (Admin only for payroll export)
router.use(authenticateUser);

/**
 * Export payroll data
 * POST /api/timesheets/export-payroll
 */
router.post('/export-payroll', requireRoles(['admin']), timesheetController.exportPayroll);

module.exports = router;
