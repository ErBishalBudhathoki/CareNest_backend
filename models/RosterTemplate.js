/**
 * Roster Template Model Schema
 * Blueprint for recurring shifts that can be deployed on a schedule
 * 
 * @file backend/models/RosterTemplate.js
 */

class RosterTemplateSchema {
    /**
     * Validate roster template data
     * @param {Object} data - Template data to validate
     * @returns {Object} { isValid: boolean, errors: string[] }
     */
    static validate(data) {
        const errors = [];

        // Required fields
        if (!data.name || typeof data.name !== 'string' || data.name.trim() === '') {
            errors.push('Template name is required');
        }

        if (!data.organizationId || typeof data.organizationId !== 'string') {
            errors.push('organizationId is required');
        }

        // Validate pattern
        if (!data.pattern) {
            errors.push('pattern is required');
        } else {
            // dayOfWeek: 0-6 (Sunday-Saturday)
            if (typeof data.pattern.dayOfWeek !== 'number' ||
                data.pattern.dayOfWeek < 0 ||
                data.pattern.dayOfWeek > 6) {
                errors.push('pattern.dayOfWeek must be 0-6 (Sunday-Saturday)');
            }

            // startTime format: HH:MM
            if (!data.pattern.startTime ||
                !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(data.pattern.startTime)) {
                errors.push('pattern.startTime must be in HH:MM format');
            }

            // endTime format: HH:MM
            if (!data.pattern.endTime ||
                !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(data.pattern.endTime)) {
                errors.push('pattern.endTime must be in HH:MM format');
            }

            // Validate time order
            if (data.pattern.startTime && data.pattern.endTime) {
                const [startH, startM] = data.pattern.startTime.split(':').map(Number);
                const [endH, endM] = data.pattern.endTime.split(':').map(Number);
                const startMinutes = startH * 60 + startM;
                const endMinutes = endH * 60 + endM;
                if (endMinutes <= startMinutes) {
                    errors.push('pattern.endTime must be after pattern.startTime');
                }
            }

            // breakDuration: optional, must be non-negative
            if (data.pattern.breakDuration !== undefined) {
                if (typeof data.pattern.breakDuration !== 'number' || data.pattern.breakDuration < 0) {
                    errors.push('pattern.breakDuration must be a non-negative number (minutes)');
                }
            }
        }

        // Validate supportItems if provided
        if (data.supportItems && !Array.isArray(data.supportItems)) {
            errors.push('supportItems must be an array');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * Get the schema definition for MongoDB collection creation
     * @returns {Object} Schema definition
     */
    static getSchemaDefinition() {
        return {
            name: { type: 'String', required: true },
            organizationId: { type: 'String', required: true, index: true },
            pattern: {
                dayOfWeek: { type: 'Number', required: true, min: 0, max: 6 },
                startTime: { type: 'String', required: true }, // "HH:MM" format
                endTime: { type: 'String', required: true },   // "HH:MM" format
                breakDuration: { type: 'Number', default: 0 }  // minutes
            },
            defaultEmployeeId: { type: 'ObjectId', ref: 'users', required: false },
            defaultEmployeeEmail: { type: 'String', required: false },
            defaultClientId: { type: 'ObjectId', ref: 'clients', required: false },
            defaultClientEmail: { type: 'String', required: false },
            supportItems: [{
                itemNumber: { type: 'String' },
                itemName: { type: 'String' },
                unit: { type: 'String' },
                supportCategoryNumber: { type: 'String' },
                supportCategoryName: { type: 'String' }
            }],
            isActive: { type: 'Boolean', default: true },
            createdAt: { type: 'Date', default: () => new Date() },
            updatedAt: { type: 'Date', default: () => new Date() },
            createdBy: { type: 'String' }
        };
    }

    /**
     * Get indexes for the rosterTemplates collection
     * @returns {Array} Index definitions
     */
    static getIndexes() {
        return [
            { key: { organizationId: 1, isActive: 1 }, name: 'org_active_idx' },
            { key: { organizationId: 1, 'pattern.dayOfWeek': 1 }, name: 'org_day_idx' },
            { key: { name: 1, organizationId: 1 }, name: 'name_org_idx', unique: true }
        ];
    }

    /**
     * Get day name from day number
     * @param {number} dayOfWeek - 0-6
     * @returns {string} Day name
     */
    static getDayName(dayOfWeek) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[dayOfWeek] || 'Unknown';
    }

    /**
     * Calculate shift duration in hours
     * @param {Object} pattern - Pattern with startTime and endTime
     * @returns {number} Duration in hours
     */
    static calculateDuration(pattern) {
        if (!pattern.startTime || !pattern.endTime) return 0;

        const [startH, startM] = pattern.startTime.split(':').map(Number);
        const [endH, endM] = pattern.endTime.split(':').map(Number);

        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        const breakMinutes = pattern.breakDuration || 0;

        return (endMinutes - startMinutes - breakMinutes) / 60;
    }

    /**
     * Normalize template data for database insertion
     * @param {Object} data - Raw template data
     * @returns {Object} Normalized template document
     */
    static normalize(data) {
        const now = new Date();

        return {
            name: data.name.trim(),
            organizationId: data.organizationId,
            pattern: {
                dayOfWeek: data.pattern.dayOfWeek,
                startTime: data.pattern.startTime,
                endTime: data.pattern.endTime,
                breakDuration: data.pattern.breakDuration || 0
            },
            defaultEmployeeId: data.defaultEmployeeId || null,
            defaultEmployeeEmail: data.defaultEmployeeEmail || null,
            defaultClientId: data.defaultClientId || null,
            defaultClientEmail: data.defaultClientEmail || null,
            supportItems: data.supportItems || [],
            isActive: data.isActive !== false,
            createdAt: data.createdAt || now,
            updatedAt: now,
            createdBy: data.createdBy || null
        };
    }

    /**
     * Generate shift dates from template for a given date range
     * @param {Object} template - Normalized template document
     * @param {Date} startDate - Range start
     * @param {Date} endDate - Range end
     * @returns {Array} Array of { date, startTime, endTime } objects
     */
    static generateShiftDates(template, startDate, endDate) {
        const shifts = [];
        const current = new Date(startDate);
        current.setHours(0, 0, 0, 0);

        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        while (current <= end) {
            if (current.getDay() === template.pattern.dayOfWeek) {
                const [startH, startM] = template.pattern.startTime.split(':').map(Number);
                const [endH, endM] = template.pattern.endTime.split(':').map(Number);

                const shiftStart = new Date(current);
                shiftStart.setHours(startH, startM, 0, 0);

                const shiftEnd = new Date(current);
                shiftEnd.setHours(endH, endM, 0, 0);

                shifts.push({
                    date: new Date(current),
                    startTime: shiftStart,
                    endTime: shiftEnd,
                    breakDuration: template.pattern.breakDuration
                });
            }
            current.setDate(current.getDate() + 1);
        }

        return shifts;
    }
}

module.exports = RosterTemplateSchema;
