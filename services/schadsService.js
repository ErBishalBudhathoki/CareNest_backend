
class SCHADSService {
    /**
     * Calculate breakdown of hours for a shift based on SCHADS Award rules
     * @param {Object} shift - The shift object with startTime, endTime, breakDuration, isPublicHoliday
     * @param {Object} config - Optional configuration overrides
     * @returns {Object} Breakdown of hours by category
     */
    calculateShiftBreakdown(shift, config = {}) {
        const breakdown = {
            baseHours: 0,
            afternoonShiftHours: 0,
            nightShiftHours: 0,
            saturdayHours: 0,
            sundayHours: 0,
            publicHolidayHours: 0,
            overtimeFirst2h: 0,
            overtimeAfter2h: 0,
            totalHours: 0
        };

        if (!shift.startTime || !shift.endTime) {
            return breakdown;
        }

        const start = new Date(shift.startTime);
        const end = new Date(shift.endTime);
        const breakMins = shift.breakDuration || 0;

        // Calculate total duration in hours (excluding break)
        const totalDurationMs = end - start;
        const totalDurationMins = (totalDurationMs / (1000 * 60)) - breakMins;
        
        if (totalDurationMins <= 0) return breakdown;

        const totalHours = totalDurationMins / 60;
        breakdown.totalHours = parseFloat(totalHours.toFixed(2));

        // 1. Public Holiday Check (Highest Priority)
        if (shift.isPublicHoliday) {
            // Check if OT applies on PH? Usually double time and a half for all hours.
            // If standard hours exceeded, it's still 250% (or higher?). 
            // SCHADS: PH OT is 250%. So simplified: All PH hours are PH penalty.
            breakdown.publicHolidayHours = breakdown.totalHours;
            return breakdown;
        }

        // 2. Day of Week Check
        const dayOfWeek = start.getDay(); // 0 = Sunday, 6 = Saturday

        if (dayOfWeek === 0) { // Sunday
            // SCHADS Sunday OT is 200%. Sunday Ordinary is 200%.
            // So effectively same rate for all Sunday hours (unless Casual?).
            breakdown.sundayHours = breakdown.totalHours;
            return breakdown;
        } else if (dayOfWeek === 6) { // Saturday
            // SCHADS Saturday OT is 150% first 2h, 200% after? 
            // Saturday Ordinary is 150%. 
            // So effectively 150% for first 8h (or 10h) then OT logic applies?
            // For simplicity in this "Breakdown" function, we bucket as Saturday.
            // The PayrollService will apply OT logic if needed, but here we just return Saturday hours.
            // Wait, if we want to support OT on Saturday (200% after 2h), we need to split.
            // However, typical setup: Saturday Ordinary = 150%. Saturday OT = 150% (first 2h) then 200%.
            // So Saturday is effectively 150% unless it goes very long.
            breakdown.saturdayHours = breakdown.totalHours;
            return breakdown;
        }

        // 3. Weekday Processing (Monday-Friday)
        
        // Define standard hours for OT trigger
        const standardDayHours = config.standardDayHours || 8; // Max ordinary hours per day
        
        // Calculate Overtime portion
        let ordinaryHours = Math.min(totalHours, standardDayHours);
        let overtimeTotal = Math.max(0, totalHours - standardDayHours);
        
        // Split Overtime
        breakdown.overtimeFirst2h = parseFloat(Math.min(2, overtimeTotal).toFixed(2));
        breakdown.overtimeAfter2h = parseFloat(Math.max(0, overtimeTotal - 2).toFixed(2));

        // 4. Shift Loading (Afternoon vs Night) on Ordinary Hours
        // Afternoon Shift: Finishes after 8 PM and at or before 12 Midnight (Mon-Fri)
        // Night Shift: Finishes after 12 Midnight or commences before 6 AM (Mon-Fri)
        
        const shiftEndHour = end.getHours();
        const shiftStartHour = start.getHours();
        
        // Check "Night Shift" condition first (Finishes > 12am OR Starts < 6am)
        // Note: Finishes > 12am usually means it crosses midnight or ends at e.g. 01:00.
        // If end date > start date, it definitely finishes after midnight.
        // If same day, check hours.
        const crossesMidnight = end.getDate() !== start.getDate();
        const finishesAfterMidnight = crossesMidnight || (shiftEndHour >= 0 && shiftEndHour < 6); // Simple check
        const startsBefore6am = shiftStartHour < 6;

        let isNightShift = finishesAfterMidnight || startsBefore6am;
        
        // Check "Afternoon Shift" condition (Finishes > 8pm and <= 12am)
        // 20:00 = 8 PM.
        let isAfternoonShift = false;
        if (!isNightShift) {
            // Must finish after 8 PM.
            // If same day and end hour >= 20. (Actually > 20:00).
            // Example: Ends 20:30.
            const endMins = shiftEndHour * 60 + end.getMinutes();
            const thresholdMins = 20 * 60; // 1200 mins
            
            if (endMins > thresholdMins) {
                isAfternoonShift = true;
            }
        }

        // SCHADS Rule: The WHOLE shift gets the loading if it meets the criteria?
        // "A shiftworker who works an afternoon shift..." -> Yes, usually applies to the whole shift.
        // "A shiftworker who works a night shift..." -> Yes, whole shift.
        // Note: This is a simplification. Some interpretations split hours. 
        // But standard award interpretation is "Shift Allowance" applies to the shift.
        
        if (isNightShift) {
            breakdown.nightShiftHours = parseFloat(ordinaryHours.toFixed(2));
            breakdown.baseHours = 0;
        } else if (isAfternoonShift) {
            breakdown.afternoonShiftHours = parseFloat(ordinaryHours.toFixed(2));
            breakdown.baseHours = 0;
        } else {
            breakdown.baseHours = parseFloat(ordinaryHours.toFixed(2));
        }

        return breakdown;
    }
}

module.exports = new SCHADSService();
