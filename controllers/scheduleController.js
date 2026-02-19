/**
 * Schedule Controller
 * Handles HTTP requests for scheduling endpoints
 * 
 * @file backend/controllers/scheduleController.js
 */

const SchedulerService = require('../services/schedulerService');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');

class ScheduleController {
    /**
     * Create a new shift
     * POST /api/schedule/shift
     */
    static createShift = catchAsync(async (req, res) => {
        const shiftData = req.body;

        // Validation (handled by route, but safety check)
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
    });

    /**
     * Bulk create shifts
     * POST /api/schedule/bulk
     */
    static bulkDeploy = catchAsync(async (req, res) => {
        const { shifts, organizationId } = req.body;

        if (!shifts || !Array.isArray(shifts)) {
            return res.status(400).json({
                success: false,
                error: 'shifts array is required'
            });
        }

        const normalizedShifts = shifts.map(s => ({
            ...s,
            organizationId: s.organizationId || organizationId
        }));

        const result = await SchedulerService.bulkCreateShifts(normalizedShifts);

        res.status(result.success ? 201 : 207).json(result);
    });

    /**
     * Get AI-powered employee recommendations
     * GET /api/schedule/recommendations
     */
    static getRecommendations = catchAsync(async (req, res) => {
        const {
            organizationId,
            clientEmail,
            startTime,
            endTime,
            requiredSkills,
            latitude,
            longitude
        } = req.query;

        const shiftDetails = {
            organizationId,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            clientEmail,
            requiredSkills: requiredSkills ? requiredSkills.split(',') : [],
            location: (latitude && longitude) ? {
                type: 'Point',
                coordinates: [parseFloat(longitude), parseFloat(latitude)]
            } : null
        };

        const result = await SchedulerService.findBestMatch(shiftDetails);

        res.json(result);
    });

    /**
     * Check for conflicts
     * POST /api/schedule/check-conflicts
     */
    static checkConflicts = catchAsync(async (req, res) => {
        const { employeeId, employeeEmail, startTime, endTime, excludeShiftId } = req.body;

        const result = await SchedulerService.detectConflicts(
            employeeId,
            employeeEmail,
            new Date(startTime),
            new Date(endTime),
            excludeShiftId
        );

        res.json({ success: true, ...result });
    });

    /**
     * Get shifts
     * GET /api/schedule/shifts/:organizationId
     */
    static getShifts = catchAsync(async (req, res) => {
        const { organizationId } = req.params;
        const filters = req.query;

        const result = await SchedulerService.getShifts(organizationId, filters);

        res.json(result);
    });

    /**
     * Update shift
     * PUT /api/schedule/shift/:id
     */
    static updateShift = catchAsync(async (req, res) => {
        const { id } = req.params;
        const updateData = req.body;

        const result = await SchedulerService.updateShift(id, updateData);

        if (!result.success) {
            return res.status(result.code || 400).json(result);
        }

        res.json(result);
    });

    /**
     * Delete shift
     * DELETE /api/schedule/shift/:id
     */
    static deleteShift = catchAsync(async (req, res) => {
        const { id } = req.params;

        const result = await SchedulerService.deleteShift(id);

        if (!result.success) {
            return res.status(result.code || 400).json(result);
        }

        res.json(result);
    });

    /**
     * Deploy roster template
     * POST /api/schedule/deploy-template
     */
    static deployTemplate = catchAsync(async (req, res) => {
        const { templateId, startDate, endDate } = req.body;
        const createdBy = req.user.id;

        const result = await SchedulerService.deployRosterTemplate(
            templateId,
            startDate,
            endDate,
            createdBy
        );

        if (!result.success) {
            return res.status(result.code || 400).json(result);
        }

        res.json(result);
    });
}

module.exports = ScheduleController;
