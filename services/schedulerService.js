/**
 * Scheduler Service
 * Core scheduling logic for shift matching, conflict detection, and roster deployment
 * 
 * @file backend/services/schedulerService.js
 */

const mongoose = require('mongoose');
const logger = require('../config/logger');
const EventBus = require('../core/EventBus');
const Shift = require('../models/Shift');
const RosterTemplate = require('../models/RosterTemplate');
const User = require('../models/User');
const Client = require('../models/Client');
const ActiveTimer = require('../models/ActiveTimer');
const ClientAssignment = require('../models/ClientAssignment');
const aiSchedulerService = require('./aiSchedulerService');

/**
 * Scoring weights for employee matching algorithm
 */
const SCORING_WEIGHTS = {
    skills: 0.4,        // 40% weight for skill match
    availability: 0.3,  // 30% weight for availability
    distance: 0.3       // 30% weight for proximity
};

/**
 * Maximum distance in kilometers for geospatial queries
 */
const MAX_DISTANCE_KM = 100;

class SchedulerService {
    /**
     * Find the best employee matches for a shift
     * Returns a ranked list of employees with composite scores
     * 
     * @param {Object} shiftDetails - Details of the shift to fill
     * @param {string} shiftDetails.organizationId - Organization ID
     * @param {Date} shiftDetails.startTime - Shift start time
     * @param {Date} shiftDetails.endTime - Shift end time
     * @param {string} shiftDetails.clientEmail - Client email
     * @param {Array} shiftDetails.requiredSkills - Skills needed (optional)
     * @param {Object} shiftDetails.location - GeoJSON Point (optional)
     * @returns {Promise<Array>} Ranked list of employee recommendations
     */
    static async findBestMatch(shiftDetails) {
        try {
            const {
                organizationId,
                startTime,
                endTime,
                clientEmail,
                requiredSkills = [],
                location
            } = shiftDetails;

            // 1. Get all active employees in the organization
            const employees = await User.find({
                organizationId: organizationId,
                isActive: true,
                role: { $in: ['employee', 'user', 'Employee', 'User'] }
            });

            if (employees.length === 0) {
                return { success: true, recommendations: [], message: 'No employees found in organization' };
            }

            // 2. Get client location if not provided
            let clientLocation = location;
            if (!clientLocation && clientEmail) {
                const client = await Client.findOne({ clientEmail });
                if (client && client.location) {
                    clientLocation = client.location;
                }
            }

            // 3. Calculate scores for each employee
            const recommendations = [];

            for (const employee of employees) {
                const employeeId = employee._id.toString();
                const employeeEmail = employee.email;

                // 3a. Check availability (no conflicts)
                const availabilityResult = await this.checkEmployeeAvailability(
                    employeeId,
                    employeeEmail,
                    new Date(startTime),
                    new Date(endTime)
                );

                // Skip if employee has conflicts
                if (!availabilityResult.isAvailable) {
                    continue;
                }

                // 3b. Calculate skill match score
                const skillScore = this.calculateSkillScore(employee.skills || [], requiredSkills);

                // 3c. Calculate distance score
                let distanceScore = 100; // Default: full score if no location data
                let distanceKm = null;

                if (clientLocation && employee.location) {
                    const distanceResult = this.calculateDistance(employee.location, clientLocation);
                    distanceKm = distanceResult.distanceKm;
                    distanceScore = distanceResult.score;
                }

                // 3d. Calculate composite score
                const availabilityScore = 100; // Full score since they're available
                const totalScore = Math.round(
                    (skillScore * SCORING_WEIGHTS.skills) +
                    (availabilityScore * SCORING_WEIGHTS.availability) +
                    (distanceScore * SCORING_WEIGHTS.distance)
                );

                recommendations.push({
                    employeeId: employeeId,
                    employeeEmail: employeeEmail,
                    employeeName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employeeEmail,
                    firstName: employee.firstName || '',
                    lastName: employee.lastName || '',
                    matchScore: totalScore,
                    skillScore: Math.round(skillScore),
                    availabilityScore: Math.round(availabilityScore),
                    distanceScore: Math.round(distanceScore),
                    distanceKm: distanceKm,
                    skills: employee.skills || []
                });
            }

            // 4. Enhance recommendations with AI
            // We only send top 10 candidates to AI to save tokens and latency
            const topCandidates = recommendations
                .sort((a, b) => b.matchScore - a.matchScore)
                .slice(0, 10);
            
            const remainingCandidates = recommendations
                .sort((a, b) => b.matchScore - a.matchScore)
                .slice(10);

            // Get AI reasoning and re-ranking
            const aiEnhancedTop = await aiSchedulerService.getAIRecommendations(shiftDetails, topCandidates);

            // Combine back
            const finalRecommendations = [...aiEnhancedTop, ...remainingCandidates];

            return {
                success: true,
                recommendations: finalRecommendations,
                totalCandidates: employees.length,
                availableCandidates: recommendations.length
            };

        } catch (error) {
            logger.error('Error in findBestMatch', {
                error: error.message,
                stack: error.stack,
                shiftDetails
            });
            throw error;
        }
    }

    /**
     * Check if an employee is available during the given time range
     * Checks both active timers and existing shifts
     * 
     * @param {string} employeeId - Employee ObjectId as string
     * @param {string} employeeEmail - Employee email
     * @param {Date} startTime - Shift start
     * @param {Date} endTime - Shift end
     * @returns {Promise<Object>} { isAvailable: boolean, conflicts: [] }
     */
    static async checkEmployeeAvailability(employeeId, employeeEmail, startTime, endTime) {
        try {
            const conflicts = [];

            // Check for overlapping shifts in the shifts collection
            const overlappingShifts = await Shift.find({
                $and: [
                    {
                        $or: [
                            { employeeId: employeeId },
                            { employeeEmail: employeeEmail }
                        ]
                    },
                    {
                        $or: [
                            // New shift starts during existing shift
                            { startTime: { $lte: startTime }, endTime: { $gt: startTime } },
                            // New shift ends during existing shift
                            { startTime: { $lt: endTime }, endTime: { $gte: endTime } },
                            // New shift completely contains existing shift
                            { startTime: { $gte: startTime }, endTime: { $lte: endTime } }
                        ]
                    }
                ],
                status: { $nin: ['cancelled'] },
                isActive: { $ne: false }
            });

            if (overlappingShifts.length > 0) {
                conflicts.push(...overlappingShifts.map(s => ({
                    type: 'shift',
                    shiftId: s._id.toString(),
                    startTime: s.startTime,
                    endTime: s.endTime
                })));
            }

            // Check for active timers
            const activeTimer = await ActiveTimer.findOne({
                userEmail: employeeEmail,
                startTime: { $lte: endTime }
            });

            if (activeTimer) {
                conflicts.push({
                    type: 'activeTimer',
                    timerId: activeTimer._id.toString(),
                    startTime: activeTimer.startTime,
                    clientEmail: activeTimer.clientEmail
                });
            }

            // Check existing clientAssignments
            const assignmentConflict = await this.checkAssignmentConflicts(
                employeeEmail,
                startTime,
                endTime
            );

            if (assignmentConflict.hasConflict) {
                conflicts.push(...assignmentConflict.conflicts);
            }

            return {
                isAvailable: conflicts.length === 0,
                conflicts: conflicts
            };

        } catch (error) {
            logger.error('Error checking employee availability', {
                error: error.message,
                employeeId,
                employeeEmail
            });
            // Default to unavailable on error to be safe
            return { isAvailable: false, conflicts: [{ type: 'error', message: error.message }] };
        }
    }

    /**
     * Check for conflicts in clientAssignments (existing schedule)
     * 
     * @param {string} employeeEmail - Employee email
     * @param {Date} startTime - Proposed start time
     * @param {Date} endTime - Proposed end time
     * @returns {Promise<Object>} { hasConflict: boolean, conflicts: [] }
     */
    static async checkAssignmentConflicts(employeeEmail, startTime, endTime) {
        try {
            const conflicts = [];

            // Get all active assignments for this employee
            const assignments = await ClientAssignment.find({
                userEmail: employeeEmail,
                isActive: true
            });

            // Format the proposed shift date for comparison
            const proposedDate = startTime.toISOString().split('T')[0];
            const proposedStartMinutes = startTime.getHours() * 60 + startTime.getMinutes();
            const proposedEndMinutes = endTime.getHours() * 60 + endTime.getMinutes();

            for (const assignment of assignments) {
                const schedule = assignment.schedule || [];

                for (const slot of schedule) {
                    // Normalize the date
                    let slotDate = slot.date;
                    if (slot.date instanceof Date) {
                        slotDate = slot.date.toISOString().split('T')[0];
                    } else if (typeof slot.date === 'string') {
                        // Handle DD-MM-YYYY or YYYY-MM-DD formats
                        if (slot.date.includes('-') && slot.date.split('-')[0].length === 2) {
                            const [dd, mm, yyyy] = slot.date.split('-');
                            slotDate = `${yyyy}-${mm}-${dd}`;
                        } else {
                            slotDate = slot.date.split('T')[0];
                        }
                    }

                    // Check if dates match
                    if (slotDate !== proposedDate) continue;

                    // Parse slot times
                    const [slotStartH, slotStartM] = (slot.startTime || '00:00').split(':').map(Number);
                    const [slotEndH, slotEndM] = (slot.endTime || '23:59').split(':').map(Number);
                    const slotStartMinutes = slotStartH * 60 + slotStartM;
                    const slotEndMinutes = slotEndH * 60 + slotEndM;

                    // Check for time overlap
                    const hasOverlap = !(proposedEndMinutes <= slotStartMinutes || proposedStartMinutes >= slotEndMinutes);

                    if (hasOverlap) {
                        conflicts.push({
                            type: 'assignment',
                            assignmentId: assignment._id.toString(),
                            clientEmail: assignment.clientEmail,
                            date: slotDate,
                            startTime: slot.startTime,
                            endTime: slot.endTime
                        });
                    }
                }
            }

            return {
                hasConflict: conflicts.length > 0,
                conflicts: conflicts
            };

        } catch (error) {
            logger.error('Error checking assignment conflicts', {
                error: error.message,
                employeeEmail
            });
            return { hasConflict: false, conflicts: [] };
        }
    }

    /**
     * Detect conflicts for a proposed shift
     * Used as middleware before creating shifts
     * 
     * @param {string} employeeId - Employee ID
     * @param {string} employeeEmail - Employee email
     * @param {Date} startTime - Proposed start
     * @param {Date} endTime - Proposed end
     * @param {string} excludeShiftId - Shift ID to exclude (for updates)
     * @returns {Promise<Object>} { hasConflict: boolean, conflicts: [], message: string }
     */
    static async detectConflicts(employeeId, employeeEmail, startTime, endTime, excludeShiftId = null) {
        try {
            const conflicts = [];

            // Build query for overlapping shifts
            const shiftQuery = {
                status: { $nin: ['cancelled'] },
                isActive: { $ne: false },
                $and: [
                    {
                        $or: [
                            { startTime: { $lt: endTime }, endTime: { $gt: startTime } }
                        ]
                    }
                ]
            };

            // Filter by employee
            if (employeeId) {
                shiftQuery.$or = [
                    { employeeId: employeeId },
                    { employeeEmail: employeeEmail }
                ];
            } else if (employeeEmail) {
                shiftQuery.employeeEmail = employeeEmail;
            }

            // Exclude current shift if updating
            if (excludeShiftId) {
                shiftQuery._id = { $ne: excludeShiftId };
            }

            const overlappingShifts = await Shift.find(shiftQuery);

            for (const shift of overlappingShifts) {
                conflicts.push({
                    type: 'shift',
                    shiftId: shift._id.toString(),
                    clientEmail: shift.clientEmail,
                    startTime: shift.startTime,
                    endTime: shift.endTime,
                    status: shift.status
                });
            }

            // Also check clientAssignments
            if (employeeEmail) {
                const assignmentConflicts = await this.checkAssignmentConflicts(
                    employeeEmail,
                    new Date(startTime),
                    new Date(endTime)
                );
                if (assignmentConflicts.hasConflict) {
                    conflicts.push(...assignmentConflicts.conflicts);
                }
            }

            const hasConflict = conflicts.length > 0;
            let message = hasConflict
                ? `Employee has ${conflicts.length} conflicting assignment(s) during this time`
                : 'No conflicts detected';

            return {
                hasConflict,
                conflicts,
                message
            };

        } catch (error) {
            logger.error('Error detecting conflicts', {
                error: error.message,
                employeeId,
                employeeEmail
            });
            throw error;
        }
    }

    /**
     * Calculate skill match score
     * 
     * @param {Array} employeeSkills - Employee's skills
     * @param {Array} requiredSkills - Skills needed for the shift
     * @returns {number} Score 0-100
     */
    static calculateSkillScore(employeeSkills, requiredSkills) {
        if (!requiredSkills || requiredSkills.length === 0) {
            return 100; // Full score if no skills required
        }

        if (!employeeSkills || employeeSkills.length === 0) {
            return 0; // No score if employee has no skills listed
        }

        const normalizedEmployeeSkills = employeeSkills.map(s => s.toLowerCase().trim());
        const normalizedRequired = requiredSkills.map(s => s.toLowerCase().trim());

        let matchCount = 0;
        for (const required of normalizedRequired) {
            if (normalizedEmployeeSkills.some(skill =>
                skill.includes(required) || required.includes(skill)
            )) {
                matchCount++;
            }
        }

        return Math.round((matchCount / normalizedRequired.length) * 100);
    }

    /**
     * Calculate distance score based on GeoJSON coordinates
     * 
     * @param {Object} employeeLocation - Employee's location { type: 'Point', coordinates: [lng, lat] }
     * @param {Object} clientLocation - Client's location
     * @returns {Object} { distanceKm: number, score: number }
     */
    static calculateDistance(employeeLocation, clientLocation) {
        try {
            if (!employeeLocation?.coordinates || !clientLocation?.coordinates) {
                return { distanceKm: null, score: 100 };
            }

            const [lng1, lat1] = employeeLocation.coordinates;
            const [lng2, lat2] = clientLocation.coordinates;

            // Haversine formula
            const R = 6371; // Earth radius in km
            const dLat = this.toRadians(lat2 - lat1);
            const dLon = this.toRadians(lng2 - lng1);

            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);

            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distanceKm = R * c;

            // Score: 100 for 0km, linearly decreasing to 0 at MAX_DISTANCE_KM
            const score = Math.max(0, 100 - (distanceKm / MAX_DISTANCE_KM) * 100);

            return {
                distanceKm: Math.round(distanceKm * 10) / 10,
                score: Math.round(score)
            };

        } catch (error) {
            logger.error('Error calculating distance', { error: error.message });
            return { distanceKm: null, score: 50 };
        }
    }

    /**
     * Convert degrees to radians
     */
    static toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Create a new shift with conflict detection
     * 
     * @param {Object} shiftData - Shift data
     * @returns {Promise<Object>} Created shift or error
     */
    static async createShift(shiftData) {
        try {
            // Check for conflicts if employee is assigned
            if (shiftData.employeeId || shiftData.employeeEmail) {
                const conflictCheck = await this.detectConflicts(
                    shiftData.employeeId,
                    shiftData.employeeEmail,
                    new Date(shiftData.startTime),
                    new Date(shiftData.endTime)
                );

                if (conflictCheck.hasConflict) {
                    return {
                        success: false,
                        error: conflictCheck.message,
                        conflicts: conflictCheck.conflicts,
                        code: 409
                    };
                }
            }

            const newShift = new Shift(shiftData);
            const savedShift = await newShift.save();

            return {
                success: true,
                data: {
                    id: savedShift._id.toString(),
                    ...savedShift.toObject()
                },
                message: 'Shift created successfully'
            };

        } catch (error) {
            logger.error('Error creating shift', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Bulk create shifts with transactional support
     * 
     * @param {Array} shiftsData - Array of shift data objects
     * @returns {Promise<Object>} Result with created shifts and any failures
     */
    static async bulkCreateShifts(shiftsData) {
        try {
            const results = {
                created: [],
                failed: [],
                totalRequested: shiftsData.length
            };

            for (const shiftData of shiftsData) {
                try {
                    const result = await this.createShift(shiftData);
                    if (result.success) {
                        results.created.push(result.data);
                    } else {
                        results.failed.push({
                            data: shiftData,
                            error: result.error,
                            code: result.code
                        });
                    }
                } catch (error) {
                    results.failed.push({
                        data: shiftData,
                        error: error.message,
                        code: 500
                    });
                }
            }

            return {
                success: results.failed.length === 0,
                data: results,
                message: `Created ${results.created.length} of ${results.totalRequested} shifts`
            };

        } catch (error) {
            logger.error('Error in bulk create shifts', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Deploy a roster template to create shifts for a date range
     * 
     * @param {string} templateId - Roster template ID
     * @param {Date} startDate - Range start
     * @param {Date} endDate - Range end
     * @param {string} createdBy - User creating the shifts
     * @returns {Promise<Object>} Result with created shifts
     */
    static async deployRosterTemplate(templateId, startDate, endDate, createdBy) {
        try {
            // Get template
            const template = await RosterTemplate.findOne({
                _id: templateId,
                isActive: true
            });

            if (!template) {
                return {
                    success: false,
                    error: 'Roster template not found',
                    code: 404
                };
            }

            // Generate shift dates (Method should be available on model if static, or helper)
            // RosterTemplateSchema here likely refers to the Mongoose model if it has static methods
            // If generateShiftDates is a static method on the schema/model:
            const shiftDates = RosterTemplate.generateShiftDates(
                template,
                new Date(startDate),
                new Date(endDate)
            );

            // Create shifts for each generated date
            const shiftsData = shiftDates.map(sd => ({
                employeeId: template.defaultEmployeeId,
                employeeEmail: template.defaultEmployeeEmail,
                clientId: template.defaultClientId,
                clientEmail: template.defaultClientEmail,
                organizationId: template.organizationId,
                startTime: sd.startTime,
                endTime: sd.endTime,
                breakDuration: sd.breakDuration,
                supportItems: template.supportItems,
                isRecurring: true,
                recurringTemplateId: template._id,
                status: 'pending',
                createdBy: createdBy
            }));

            // Bulk create
            const result = await this.bulkCreateShifts(shiftsData);

            return {
                success: true,
                data: {
                    templateName: template.name,
                    ...result.data
                },
                message: `Deployed template "${template.name}" - ${result.message}`
            };

        } catch (error) {
            logger.error('Error deploying roster template', {
                error: error.message,
                templateId
            });
            throw error;
        }
    }

    /**
     * Get shifts for an organization with filters
     * 
     * @param {string} organizationId - Organization ID
     * @param {Object} filters - Query filters
     * @returns {Promise<Object>} Shifts array
     */
    static async getShifts(organizationId, filters = {}) {
        try {
            const query = {
                organizationId: organizationId,
                isActive: { $ne: false }
            };

            // Apply filters
            if (filters.startDate) {
                query.startTime = { $gte: new Date(filters.startDate) };
            }
            if (filters.endDate) {
                query.startTime = { ...query.startTime, $lte: new Date(filters.endDate) };
            }
            if (filters.status) {
                query.status = filters.status;
            }
            if (filters.employeeEmail) {
                query.employeeEmail = filters.employeeEmail;
            }
            if (filters.clientEmail) {
                query.clientEmail = filters.clientEmail;
            }

            const shifts = await Shift.find(query).sort({ startTime: 1 });

            return {
                success: true,
                data: shifts,
                count: shifts.length
            };

        } catch (error) {
            logger.error('Error getting shifts', {
                error: error.message,
                organizationId
            });
            throw error;
        }
    }

    /**
     * Update a shift
     * 
     * @param {string} shiftId - Shift ID
     * @param {Object} updateData - Fields to update
     * @returns {Promise<Object>} Updated shift
     */
    static async updateShift(shiftId, updateData) {
        try {
            // Check conflicts if changing employee or time
            if (updateData.employeeEmail || updateData.startTime || updateData.endTime) {
                const existingShift = await Shift.findById(shiftId);

                if (existingShift) {
                    const employeeEmail = updateData.employeeEmail || existingShift.employeeEmail;
                    const employeeId = updateData.employeeId || existingShift.employeeId;
                    const startTime = updateData.startTime || existingShift.startTime;
                    const endTime = updateData.endTime || existingShift.endTime;

                    if (employeeEmail) {
                        const conflictCheck = await this.detectConflicts(
                            employeeId,
                            employeeEmail,
                            new Date(startTime),
                            new Date(endTime),
                            shiftId
                        );

                        if (conflictCheck.hasConflict) {
                            return {
                                success: false,
                                error: conflictCheck.message,
                                conflicts: conflictCheck.conflicts,
                                code: 409
                            };
                        }
                    }
                }
            }

            // Apply update
            updateData.updatedAt = new Date();

            const result = await Shift.findOneAndUpdate(
                { _id: shiftId },
                { $set: updateData },
                { new: true }
            );

            if (!result) {
                return {
                    success: false,
                    error: 'Shift not found',
                    code: 404
                };
            }

            return {
                success: true,
                data: result,
                message: 'Shift updated successfully'
            };

        } catch (error) {
            logger.error('Error updating shift', {
                error: error.message,
                shiftId
            });
            throw error;
        }
    }

    /**
     * Cancel/delete a shift
     * 
     * @param {string} shiftId - Shift ID
     * @returns {Promise<Object>} Result
     */
    static async deleteShift(shiftId) {
        try {
            const result = await Shift.findOneAndUpdate(
                { _id: shiftId },
                {
                    $set: {
                        status: 'cancelled',
                        isActive: false,
                        updatedAt: new Date()
                    }
                },
                { new: true }
            );

            if (!result) {
                return {
                    success: false,
                    error: 'Shift not found',
                    code: 404
                };
            }

            // Event: Shift Cancelled
            EventBus.publish('shift.cancelled', { shiftId, shift: result });

            return {
                success: true,
                message: 'Shift cancelled successfully'
            };

        } catch (error) {
            logger.error('Error deleting shift', {
                error: error.message,
                shiftId
            });
            throw error;
        }
    }
}

module.exports = SchedulerService;
