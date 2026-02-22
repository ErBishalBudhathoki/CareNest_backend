const express = require('express');
const router = express.Router();
const advancedPayrollController = require('../controllers/advancedPayrollController');
const { authenticateUser } = require('../middleware/auth');

router.post('/calculate', authenticateUser, advancedPayrollController.calculatePayroll);
router.get('/payslip/:userId/:period', authenticateUser, advancedPayrollController.getPayslip);
router.post('/generate-payslips', authenticateUser, advancedPayrollController.generatePayslips);
router.get('/summary/:organizationId/:period', authenticateUser, advancedPayrollController.getPayrollSummary);
router.post('/export', authenticateUser, advancedPayrollController.exportPayrollData);

module.exports = router;
