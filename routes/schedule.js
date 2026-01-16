/**
 * Schedule Routes
 * Express router for scheduling endpoints
 * 
 * @file backend/routes/schedule.js
 */

const express = require('express');
const ScheduleController = require('../controllers/scheduleController');
const router = express.Router();

// ============================================================================
// SHIFT MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Create a new shift
 * POST /api/schedule/shift
 * 
 * Body: {
 *   organizationId: string (required),
 *   clientEmail: string,
 *   employeeEmail: string,
 *   startTime: ISO date string,
 *   endTime: ISO date string,
 *   supportItems: array,
 *   notes: string
 * }
 */
router.post('/shift', ScheduleController.createShift);

/**
 * Bulk create shifts
 * POST /api/schedule/bulk
 * 
 * Body: {
 *   organizationId: string (optional, applied to all if not in each shift),
 *   shifts: [{
 *     clientEmail: string,
 *     employeeEmail: string,
 *     startTime: ISO date string,
 *     endTime: ISO date string,
 *     ...
 *   }]
 * }
 */
router.post('/bulk', ScheduleController.bulkDeploy);

/**
 * Get shifts for an organization
 * GET /api/schedule/shifts/:organizationId
 * 
 * Query params:
 *   startDate: ISO date string
 *   endDate: ISO date string
 *   status: 'pending' | 'approved' | 'completed' | 'cancelled'
 *   employeeEmail: string
 *   clientEmail: string
 */
router.get('/shifts/:organizationId', ScheduleController.getShifts);

/**
 * Update a shift
 * PUT /api/schedule/shift/:id
 * 
 * Body: Fields to update (same as create, but all optional)
 */
router.put('/shift/:id', ScheduleController.updateShift);

/**
 * Delete/cancel a shift
 * DELETE /api/schedule/shift/:id
 */
router.delete('/shift/:id', ScheduleController.deleteShift);

// ============================================================================
// AI RECOMMENDATION ENDPOINTS
// ============================================================================

/**
 * Get AI-powered employee recommendations
 * GET /api/schedule/recommendations
 * 
 * Query params:
 *   organizationId: string (required)
 *   clientEmail: string
 *   startTime: ISO date string
 *   endTime: ISO date string
 *   requiredSkills: comma-separated list
 *   latitude: number (client location)
 *   longitude: number (client location)
 */
router.get('/recommendations', ScheduleController.getRecommendations);

/**
 * Check for conflicts before creating/updating a shift
 * POST /api/schedule/check-conflicts
 * 
 * Body: {
 *   employeeId: string,
 *   employeeEmail: string,
 *   startTime: ISO date string (required),
 *   endTime: ISO date string (required),
 *   excludeShiftId: string (for updates)
 * }
 */
router.post('/check-conflicts', ScheduleController.checkConflicts);

// ============================================================================
// ROSTER TEMPLATE ENDPOINTS
// ============================================================================

/**
 * Deploy a roster template to create shifts
 * POST /api/schedule/deploy-template
 * 
 * Body: {
 *   templateId: string (required),
 *   startDate: ISO date string (required),
 *   endDate: ISO date string (required),
 *   createdBy: string
 * }
 */
router.post('/deploy-template', ScheduleController.deployTemplate);

module.exports = router;
