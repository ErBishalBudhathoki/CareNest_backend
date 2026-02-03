const User = require('../models/User');
const WorkedTime = require('../models/WorkedTime');
const logger = require('../utils/logger');
const catchAsync = require('../utils/catchAsync');

class TimesheetController {
    /**
     * Get worked time records for a user
     * POST /api/timesheets/list
     */
    getTimesheets = catchAsync(async (req, res) => {
        const { email, startDate, endDate } = req.body;

        if (!email || !startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'Email, startDate, and endDate are required' });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // Security check: Users can only fetch their own timesheets unless admin
        const requestingUserEmail = req.user.email;
        const isAdmin = req.user.role === 'admin';
        
        if (email !== requestingUserEmail && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Unauthorized access to timesheets' });
        }

        // Query using Mongoose
        // We prioritize workDate as it's the standard Date field
        const query = {
            userEmail: email,
            workDate: { $gte: start, $lte: end },
            isActive: true
        };

        const records = await WorkedTime.find(query).sort({ workDate: -1 });

        res.status(200).json({
            success: true,
            data: records
        });
    });

    /**
     * Export payroll data for all employees within a date range
     * POST /api/timesheets/export-payroll
     */
    exportPayroll = catchAsync(async (req, res) => {
        const { startDate, endDate, organizationId } = req.body;

        if (!startDate || !endDate || !organizationId) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        logger.info(`Exporting payroll for Org: ${organizationId}, Range: ${start.toISOString()} - ${end.toISOString()}`);

        const users = await User.find({ organizationId: organizationId }).lean();
        const userMap = {};
        const userEmails = [];
        
        users.forEach(u => {
            userMap[u.email] = `${u.firstName} ${u.lastName}`;
            userEmails.push(u.email);
        });

        if (userEmails.length === 0) {
             return res.json({ success: true, csv: 'No employees found in organization' });
        }

        const workedTime = await WorkedTime.find({
            userEmail: { $in: userEmails },
            workDate: { $gte: start, $lte: end },
            isActive: true
        }).lean();

        const aggregated = {};

        userEmails.forEach(email => {
            aggregated[email] = {
                name: userMap[email] || 'Unknown',
                email: email,
                totalHours: 0,
                entries: 0,
                daysWorked: new Set()
            };
        });

        workedTime.forEach(entry => {
            const email = entry.userEmail;
            if (!aggregated[email]) return;
            
            let hours = 0;
            if (typeof entry.totalHours === 'number') {
                hours = entry.totalHours;
            } else if (entry.timeWorked) {
                const parts = entry.timeWorked.split(':');
                if (parts.length === 3) {
                    const h = parseInt(parts[0], 10) || 0;
                    const m = parseInt(parts[1], 10) || 0;
                    const s = parseInt(parts[2], 10) || 0;
                    hours = h + m/60 + s/3600;
                }
            }
            
            if (!isNaN(hours)) {
                aggregated[email].totalHours += hours;
            }
            aggregated[email].entries += 1;
            if (entry.workDate) {
                aggregated[email].daysWorked.add(new Date(entry.workDate).toDateString());
            }
        });

        let csvContent = 'Employee Name,Email,Total Hours,Days Worked,Entries,Start Date,End Date\n';
        
        Object.values(aggregated).forEach(row => {
            csvContent += `"${row.name}","${row.email}",${row.totalHours.toFixed(2)},${row.daysWorked.size},${row.entries},"${startDate}","${endDate}"\n`;
        });

        res.json({
            success: true,
            csv: csvContent,
            filename: `payroll_export_${startDate}_${endDate}.csv`
        });
    });
}

module.exports = new TimesheetController();
