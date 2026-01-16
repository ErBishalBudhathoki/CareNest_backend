/**
 * Shift Model Schema
 * Represents a scheduled work shift for NDIS service delivery
 * 
 * @file backend/models/Shift.js
 */

class ShiftSchema {
    /**
     * Validate shift data before creation/update
     * @param {Object} data - Shift data to validate
     * @returns {Object} { isValid: boolean, errors: string[] }
     */
    static validate(data) {
        const errors = [];

        // Required fields
        if (!data.clientEmail && !data.clientId) {
            errors.push('Either clientEmail or clientId is required');
        }

        if (!data.organizationId || typeof data.organizationId !== 'string') {
            errors.push('organizationId is required');
        }

        if (!data.startTime) {
            errors.push('startTime is required');
        } else {
            const start = new Date(data.startTime);
            if (isNaN(start.getTime())) {
                errors.push('Invalid startTime format');
            }
        }

        if (!data.endTime) {
            errors.push('endTime is required');
        } else {
            const end = new Date(data.endTime);
            if (isNaN(end.getTime())) {
                errors.push('Invalid endTime format');
            }
        }

        // Validate time range
        if (data.startTime && data.endTime) {
            const start = new Date(data.startTime);
            const end = new Date(data.endTime);
            if (end <= start) {
                errors.push('endTime must be after startTime');
            }
        }

        // Validate status enum
        const validStatuses = ['pending', 'approved', 'completed', 'cancelled'];
        if (data.status && !validStatuses.includes(data.status)) {
            errors.push(`status must be one of: ${validStatuses.join(', ')}`);
        }

        // Validate location GeoJSON if provided
        if (data.location) {
            if (!data.location.type || data.location.type !== 'Point') {
                errors.push('location.type must be "Point"');
            }
            if (!Array.isArray(data.location.coordinates) || data.location.coordinates.length !== 2) {
                errors.push('location.coordinates must be [longitude, latitude]');
            } else {
                const [lng, lat] = data.location.coordinates;
                if (typeof lng !== 'number' || lng < -180 || lng > 180) {
                    errors.push('longitude must be between -180 and 180');
                }
                if (typeof lat !== 'number' || lat < -90 || lat > 90) {
                    errors.push('latitude must be between -90 and 90');
                }
            }
        }

        // Validate supportItems array if provided
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
            employeeId: { type: 'ObjectId', ref: 'users', required: false },
            employeeEmail: { type: 'String', required: false },
            clientId: { type: 'ObjectId', ref: 'clients', required: false },
            clientEmail: { type: 'String', required: false },
            organizationId: { type: 'String', required: true, index: true },
            startTime: { type: 'Date', required: true, index: true },
            endTime: { type: 'Date', required: true },
            supportItems: [{
                itemNumber: { type: 'String' },
                itemName: { type: 'String' },
                unit: { type: 'String' },
                supportCategoryNumber: { type: 'String' },
                supportCategoryName: { type: 'String' }
            }],
            location: {
                type: { type: 'String', enum: ['Point'], default: 'Point' },
                coordinates: { type: ['Number'], default: [0, 0] }
            },
            status: {
                type: 'String',
                enum: ['pending', 'approved', 'completed', 'cancelled'],
                default: 'pending',
                index: true
            },
            isRecurring: { type: 'Boolean', default: false },
            recurringTemplateId: { type: 'ObjectId', ref: 'rosterTemplates', required: false },
            notes: { type: 'String', default: '' },
            breakDuration: { type: 'Number', default: 0 }, // in minutes
            isActive: { type: 'Boolean', default: true },
            createdAt: { type: 'Date', default: () => new Date() },
            updatedAt: { type: 'Date', default: () => new Date() },
            createdBy: { type: 'String' }
        };
    }

    /**
     * Get indexes for the shifts collection
     * @returns {Array} Index definitions
     */
    static getIndexes() {
        return [
            // Compound index for conflict detection
            { key: { employeeId: 1, startTime: 1, endTime: 1, status: 1 }, name: 'conflict_check_idx' },
            // Compound index for organization queries
            { key: { organizationId: 1, startTime: 1, status: 1 }, name: 'org_shifts_idx' },
            // GeoSpatial index for location-based queries
            { key: { location: '2dsphere' }, name: 'location_geo_idx' },
            // Employee lookup
            { key: { employeeEmail: 1, organizationId: 1 }, name: 'employee_org_idx' },
            // Client lookup
            { key: { clientEmail: 1, organizationId: 1 }, name: 'client_org_idx' }
        ];
    }

    /**
     * Normalize shift data for database insertion
     * @param {Object} data - Raw shift data
     * @returns {Object} Normalized shift document
     */
    static normalize(data) {
        const now = new Date();

        return {
            employeeId: data.employeeId || null,
            employeeEmail: data.employeeEmail || null,
            clientId: data.clientId || null,
            clientEmail: data.clientEmail || null,
            organizationId: data.organizationId,
            startTime: new Date(data.startTime),
            endTime: new Date(data.endTime),
            supportItems: data.supportItems || [],
            location: data.location || { type: 'Point', coordinates: [0, 0] },
            status: data.status || 'pending',
            isRecurring: data.isRecurring || false,
            recurringTemplateId: data.recurringTemplateId || null,
            notes: data.notes || '',
            breakDuration: data.breakDuration || 0,
            isActive: data.isActive !== false,
            createdAt: data.createdAt || now,
            updatedAt: now,
            createdBy: data.createdBy || null
        };
    }
}

module.exports = ShiftSchema;
