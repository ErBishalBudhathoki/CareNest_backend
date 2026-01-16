/**
 * Schedule Controller
 * Handles HTTP requests for scheduling endpoints
 * 
 * @file backend/controllers/scheduleController.js
 */

const SchedulerService = require('../services/schedulerService');
const logger = require('../config/logger');

class ScheduleController {
    /**
     * Create a new shift
     * POST /api/schedule/shift
     */
    static async createShift(req, res) {
        try {
            const shiftData = req.body;

            if (!shiftData.organizationId) {
                return res.status(400).json({
                    success: false,
                    error: 'organizationId is required'
                });
            }

            const result = await SchedulerService.createShift(shiftData);

            if (!result.success) {
                return res.status(result.code || 400).json(result);
            }

            res.status(201).json(result);
        } catch (error) {
            logger.error('Error in createShift controller', {
                error: error.message,
                stack: error.stack
            });
            res.status(500).json({
                success: false,
                error: 'Failed to create shift'
            });
        }
    }

    /**
     * Bulk create shifts
     * POST /api/schedule/bulk
     */
    static async bulkDeploy(req, res) {
        try {
            const { shifts, organizationId } = req.body;

            if (!shifts || !Array.isArray(shifts)) {
                return res.status(400).json({
                    success: false,
                    error: 'shifts array is required'
                });
            }

            // Ensure all shifts have organizationId
            const normalizedShifts = shifts.map(s => ({
                ...s,
                organizationId: s.organizationId || organizationId
            }));

            const result = await SchedulerService.bulkCreateShifts(normalizedShifts);

            res.status(result.success ? 201 : 207).json(result);
        } catch (error) {
            logger.error('Error in bulkDeploy controller', {
                error: error.message,
                stack: error.stack
            });
            res.status(500).json({
                success: false,
                error: 'Failed to create shifts in bulk'
            });
        }
    }

    /**
     * Get AI-powered employee recommendations for a shift
     * GET /api/schedule/recommendations
     */
    static async getRecommendations(req, res) {
        try {
            const {
                organizationId,
                clientEmail,
                startTime,
                endTime,
                requiredSkills,
                latitude,
                longitude
            } = req.query;

            if (!organizationId) {
                return res.status(400).json({
                    success: false,
                    error: 'organizationId is required'
                });
            }

            const shiftDetails = {
                organizationId,
                clientEmail,
                startTime: startTime ? new Date(startTime) : new Date(),
                endTime: endTime ? new Date(endTime) : new Date(Date.now() + 8 * 60 * 60 * 1000),
                requiredSkills: requiredSkills ? requiredSkills.split(',') : [],
                location: latitude && longitude ? {
                    type: 'Point',
                    coordinates: [parseFloat(longitude), parseFloat(latitude)]
                } : null
            };

            const result = await SchedulerService.findBestMatch(shiftDetails);

            res.status(200).json(result);
        } catch (error) {
            logger.error('Error in getRecommendations controller', {
                error: error.message,
                stack: error.stack
            });
            res.status(500).json({
                success: false,
                error: 'Failed to get recommendations'
            });
        }
    }

    /**
     * Get shifts for an organization
     * GET /api/schedule/shifts/:organizationId
     */
    static async getShifts(req, res) {
        try {
            const { organizationId } = req.params;
            const { startDate, endDate, status, employeeEmail, clientEmail } = req.query;

            if (!organizationId) {
                return res.status(400).json({
                    success: false,
                    error: 'organizationId is required'
                });
            }

            const filters = {};
            if (startDate) filters.startDate = startDate;
            if (endDate) filters.endDate = endDate;
            if (status) filters.status = status;
            if (employeeEmail) filters.employeeEmail = employeeEmail;
            if (clientEmail) filters.clientEmail = clientEmail;

            const result = await SchedulerService.getShifts(organizationId, filters);

            res.status(200).json(result);
        } catch (error) {
            logger.error('Error in getShifts controller', {
                error: error.message,
                stack: error.stack,
                organizationId: req.params.organizationId
            });
            res.status(500).json({
                success: false,
                error: 'Failed to get shifts'
            });
        }
    }

    /**
     * Update a shift
     * PUT /api/schedule/shift/:id
     */
    static async updateShift(req, res) {
        try {
            const { id } = req.params;
            const updateData = req.body;

            if (!id) {
                return res.status(400).json({
                    success: false,
                    error: 'Shift ID is required'
                });
            }

            const result = await SchedulerService.updateShift(id, updateData);

            if (!result.success) {
                return res.status(result.code || 400).json(result);
            }

            res.status(200).json(result);
        } catch (error) {
            logger.error('Error in updateShift controller', {
                error: error.message,
                stack: error.stack,
                shiftId: req.params.id
            });
            res.status(500).json({
                success: false,
                error: 'Failed to update shift'
            });
        }
    }

    /**
     * Delete/cancel a shift
     * DELETE /api/schedule/shift/:id
     */
    static async deleteShift(req, res) {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({
                    success: false,
                    error: 'Shift ID is required'
                });
            }

            const result = await SchedulerService.deleteShift(id);

            if (!result.success) {
                return res.status(result.code || 400).json(result);
            }

            res.status(200).json(result);
        } catch (error) {
            logger.error('Error in deleteShift controller', {
                error: error.message,
                stack: error.stack,
                shiftId: req.params.id
            });
            res.status(500).json({
                success: false,
                error: 'Failed to delete shift'
            });
        }
    }

    /**
     * Deploy a roster template
     * POST /api/schedule/deploy-template
     */
    static async deployTemplate(req, res) {
        try {
            const { templateId, startDate, endDate, createdBy } = req.body;

            if (!templateId) {
                return res.status(400).json({
                    success: false,
                    error: 'templateId is required'
                });
            }

            if (!startDate || !endDate) {
                return res.status(400).json({
                    success: false,
                    error: 'startDate and endDate are required'
                });
            }

            const result = await SchedulerService.deployRosterTemplate(
                templateId,
                startDate,
                endDate,
                createdBy
            );

            if (!result.success) {
                return res.status(result.code || 400).json(result);
            }

            res.status(201).json(result);
        } catch (error) {
            logger.error('Error in deployTemplate controller', {
                error: error.message,
                stack: error.stack
            });
            res.status(500).json({
                success: false,
                error: 'Failed to deploy template'
            });
        }
    }

    /**
     * Check conflicts for a proposed shift
     * POST /api/schedule/check-conflicts
     */
    static async checkConflicts(req, res) {
        try {
            const { employeeId, employeeEmail, startTime, endTime, excludeShiftId } = req.body;

            if (!startTime || !endTime) {
                return res.status(400).json({
                    success: false,
                    error: 'startTime and endTime are required'
                });
            }

            if (!employeeId && !employeeEmail) {
                return res.status(400).json({
                    success: false,
                    error: 'Either employeeId or employeeEmail is required'
                });
            }

            const result = await SchedulerService.detectConflicts(
                employeeId,
                employeeEmail,
                new Date(startTime),
                new Date(endTime),
                excludeShiftId
            );

            res.status(200).json({
                success: true,
                ...result
            });
        } catch (error) {
            logger.error('Error in checkConflicts controller', {
                error: error.message,
                stack: error.stack
            });
            res.status(500).json({
                success: false,
                error: 'Failed to check conflicts'
            });
        }
    }
}

module.exports = ScheduleController;
