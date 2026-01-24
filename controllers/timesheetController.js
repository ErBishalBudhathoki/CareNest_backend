const { getDatabase } = require('../config/database');
const logger = require('../config/logger');

class TimesheetController {
    /**
     * Export payroll data for all employees within a date range
     * POST /api/timesheets/export-payroll
     */
    async exportPayroll(req, res) {
        try {
            const { startDate, endDate, organizationId } = req.body;

            if (!startDate || !endDate || !organizationId) {
                return res.status(400).json({ success: false, message: 'Missing required fields: startDate, endDate, organizationId' });
            }

            const db = await getDatabase();
            const start = new Date(startDate);
            const end = new Date(endDate);
            // End date should be inclusive of the day (23:59:59)
            end.setHours(23, 59, 59, 999);

            logger.info(`Exporting payroll for Org: ${organizationId}, Range: ${start.toISOString()} - ${end.toISOString()}`);

            // 1. Fetch Users in Organization (to map email to name)
            const users = await db.collection('users').find({ organizationId: organizationId }).toArray();
            const userMap = {};
            const userEmails = [];
            
            users.forEach(u => {
                userMap[u.email] = `${u.firstName} ${u.lastName}`;
                userEmails.push(u.email);
            });

            if (userEmails.length === 0) {
                 return res.json({ success: true, csv: 'No employees found in organization' });
            }

            // 2. Fetch Worked Time
            const workedTime = await db.collection('workedTime').find({
                userEmail: { $in: userEmails },
                workDate: { $gte: start, $lte: end }
            }).toArray();

            // 3. Aggregate Data
            const aggregated = {};

            // Initialize all users with 0 hours
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
                if (!aggregated[email]) return; // Should not happen given filter
                
                let hours = 0;
                if (entry.totalHours) {
                    hours = parseFloat(entry.totalHours) || 0;
                } else if (entry.timeWorked) {
                    // Format "HH:mm:ss"
                    const parts = entry.timeWorked.split(':');
                    if (parts.length === 3) {
                        hours = (parseInt(parts[0]) || 0) + (parseInt(parts[1]) || 0)/60 + (parseInt(parts[2]) || 0)/3600;
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

            // 4. Generate CSV
            // Header
            let csvContent = 'Employee Name,Email,Total Hours,Days Worked,Entries,Start Date,End Date\n';
            
            Object.values(aggregated).forEach(row => {
                // Only include employees with hours? Or all? 
                // Requirement says "all employees for payroll". Usually payroll needs everyone or at least active ones.
                // We'll include everyone but filter out 0 hours if requested. 
                // For now include everyone to be safe.
                if (row.totalHours >= 0) {
                     csvContent += `"${row.name}","${row.email}",${row.totalHours.toFixed(2)},${row.daysWorked.size},${row.entries},"${startDate}","${endDate}"\n`;
                }
            });

            // 5. Send Response as JSON with CSV string
            // This allows the frontend ApiMethod to handle it easily
            res.json({
                success: true,
                csv: csvContent,
                filename: `payroll_export_${startDate}_${endDate}.csv`
            });

        } catch (error) {
            logger.error('Error exporting payroll:', error);
            res.status(500).json({ success: false, message: 'Failed to export payroll: ' + error.message });
        }
    }
}

module.exports = new TimesheetController();
