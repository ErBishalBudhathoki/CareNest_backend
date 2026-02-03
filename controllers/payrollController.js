const payrollService = require('../services/payrollService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class PayrollController {
    /**
     * Get Payroll Summary
     * @route GET /api/payroll/summary
     */
    getSummary = catchAsync(async (req, res) => {
        const { startDate, endDate } = req.query;
        const organizationId = req.user.organizationId;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                code: 'VALIDATION_ERROR',
                message: 'StartDate and EndDate are required'
            });
        }

        if (!organizationId) {
            return res.status(400).json({
                success: false,
                code: 'ORGANIZATION_REQUIRED',
                message: 'User does not belong to an organization'
            });
        }

        const summary = await payrollService.getPayrollSummary(organizationId, startDate, endDate);

        logger.business('Payroll Summary Generated', {
            event: 'payroll_summary_generated',
            organizationId,
            startDate,
            endDate,
            totalEmployees: summary.summary?.totalEmployees || 0,
            totalGrossPay: summary.summary?.totalGrossPay || 0,
            userEmail: req.user.email,
            timestamp: new Date().toISOString()
        });

        res.status(200).json({
            success: true,
            code: 'PAYROLL_SUMMARY_SUCCESS',
            data: summary
        });
    });

    /**
     * Export Payroll Data
     * @route POST /api/payroll/export/:format
     */
    exportPayroll = catchAsync(async (req, res) => {
        const { format } = req.params;
        const { startDate, endDate } = req.body;
        const organizationId = req.user.organizationId;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                code: 'VALIDATION_ERROR',
                message: 'StartDate and EndDate are required'
            });
        }

        const summary = await payrollService.getPayrollSummary(organizationId, startDate, endDate);

        logger.business('Payroll Export Generated', {
            event: 'payroll_export_generated',
            organizationId,
            format,
            startDate,
            endDate,
            userEmail: req.user.email,
            timestamp: new Date().toISOString()
        });

        if (format === 'json') {
            return res.status(200).json({
                success: true,
                code: 'PAYROLL_EXPORT_SUCCESS',
                data: summary
            });
        } else if (format === 'csv') {
            // Simplified CSV generation
            let csv = 'Employee,Email,Hours,Gross Pay,Tax,Super\n';
            summary.employees.forEach(emp => {
                csv += `"${emp.name}","${emp.email}",${emp.hoursWorked},${emp.grossPay},${emp.tax},${emp.super}\n`;
            });
            
            res.header('Content-Type', 'text/csv');
            res.attachment(`payroll-${startDate}-${endDate}.csv`);
            return res.send(csv);
        } else {
            return res.status(400).json({
                success: false,
                code: 'INVALID_FORMAT',
                message: 'Invalid format. Supported formats: json, csv'
            });
        }
    });
}

module.exports = new PayrollController();
