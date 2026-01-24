const payrollService = require('../services/payrollService');
const logger = require('../config/logger');

class PayrollController {
    /**
     * Get Payroll Summary
     * @route GET /api/payroll/summary
     */
    async getSummary(req, res) {
        try {
            const { startDate, endDate } = req.query;
            const organizationId = req.user.organizationId;

            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    message: 'StartDate and EndDate are required'
                });
            }

            if (!organizationId) {
                return res.status(400).json({
                    success: false,
                    message: 'User does not belong to an organization'
                });
            }

            const summary = await payrollService.getPayrollSummary(organizationId, startDate, endDate);

            res.status(200).json({
                success: true,
                data: summary
            });

        } catch (error) {
            logger.error('Error in PayrollController.getSummary', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate payroll summary',
                error: error.message
            });
        }
    }

    /**
     * Export Payroll Data
     * @route POST /api/payroll/export/:format
     */
    async exportPayroll(req, res) {
        try {
            const { format } = req.params; // csv or json
            const { startDate, endDate } = req.body;
            const organizationId = req.user.organizationId;

            if (!startDate || !endDate) {
                return res.status(400).json({ success: false, message: 'Dates required' });
            }

            const summary = await payrollService.getPayrollSummary(organizationId, startDate, endDate);

            if (format === 'json') {
                return res.status(200).json({
                    success: true,
                    data: summary
                });
            } else if (format === 'csv') {
                // Simplified CSV generation
                // In real app, use json2csv library
                let csv = 'Employee,Email,Hours,Gross Pay,Tax,Super\n';
                summary.employees.forEach(emp => {
                    csv += `"${emp.name}","${emp.email}",${emp.hoursWorked},${emp.grossPay},${emp.tax},${emp.super}\n`;
                });
                
                res.header('Content-Type', 'text/csv');
                res.attachment(`payroll-${startDate}-${endDate}.csv`);
                return res.send(csv);
            } else {
                return res.status(400).json({ success: false, message: 'Invalid format' });
            }

        } catch (error) {
            logger.error('Error in PayrollController.exportPayroll', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }
}

module.exports = new PayrollController();
