
class AnomalyService {
    /**
     * Check a single shift for anomalies
     * @param {Object} shift 
     * @returns {Array} List of anomalies
     */
    checkShift(shift) {
        const anomalies = [];
        
        if (!shift.startTime || !shift.endTime) return anomalies;

        const start = new Date(shift.startTime);
        const end = new Date(shift.endTime);
        const durationHours = (end - start) / (1000 * 60 * 60);

        // 1. Excessive Hours
        if (durationHours > 12) {
            anomalies.push({
                type: 'excessive_hours',
                description: `Shift duration ${durationHours.toFixed(2)}h exceeds 12h limit`,
                severity: 'high'
            });
        }

        // 2. Insufficient Breaks
        // SCHADS: Break required after 5 hours
        if (durationHours > 5) {
            if (!shift.breakDuration || shift.breakDuration <= 0) {
                 anomalies.push({
                    type: 'insufficient_break',
                    description: `Shift > 5h requires a break`,
                    severity: 'medium'
                });
            }
        }

        // 3. Late Night / Early Morning Warning
        const startHour = start.getHours();
        const endHour = end.getHours();
        
        if (startHour < 6 || endHour > 22) { // Just a warning for visibility
             // Not strictly an anomaly if night shift is intended, but good to flag
             // Commented out to avoid noise, enable if strict monitoring needed
        }

        return anomalies;
    }

    /**
     * Check a set of shifts for pattern anomalies (e.g. short break between shifts)
     * @param {Array} shifts - Sorted array of shifts
     */
    checkShiftPatterns(shifts) {
        const anomalies = [];
        
        // Sort by start time just in case
        const sortedShifts = [...shifts].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

        for (let i = 0; i < sortedShifts.length - 1; i++) {
            const current = sortedShifts[i];
            const next = sortedShifts[i+1];
            
            const currentEnd = new Date(current.endTime);
            const nextStart = new Date(next.startTime);
            
            const breakHours = (nextStart - currentEnd) / (1000 * 60 * 60);
            
            // SCHADS: 10 hour break between shifts preferred
            if (breakHours < 10 && breakHours > 0) {
                 anomalies.push({
                    type: 'short_break',
                    description: `Only ${breakHours.toFixed(2)}h break between shifts on ${currentEnd.toDateString()}`,
                    severity: 'medium',
                    employeeId: current.employeeId, // Context
                    shiftIds: [current._id, next._id]
                });
            }
        }
        
        return anomalies;
    }
}

module.exports = new AnomalyService();
