const express = require('express');
const router = express.Router();
const payrollController = require('../controllers/payrollController');
const { authenticateUser } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

// All payroll routes require Admin access
// In future, might allow 'Payroll Officer' role

// Get Payroll Summary
// GET /api/payroll/summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get(
    '/summary',
    authenticateUser,
    requireAdmin,
    payrollController.getSummary
);

// Export Payroll Data
// POST /api/payroll/export/:format
router.post(
    '/export/:format',
    authenticateUser,
    requireAdmin,
    payrollController.exportPayroll
);

module.exports = router;
