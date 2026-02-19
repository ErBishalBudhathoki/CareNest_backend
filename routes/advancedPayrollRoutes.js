const express = require('express');
const router = express.Router();
const advancedPayrollController = require('../controllers/advancedPayrollController');

router.post('/calculate', advancedPayrollController.calculatePayroll);
router.get('/payslip/:userId/:period', advancedPayrollController.getPayslip);
router.post('/generate-payslips', advancedPayrollController.generatePayslips);
router.get('/summary/:organizationId/:period', advancedPayrollController.getPayrollSummary);
router.post('/export', advancedPayrollController.exportPayrollData);

module.exports = router;
