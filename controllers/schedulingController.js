const shiftMatchingService = require('../services/shiftMatchingService');
const User = require('../models/User');
const Appointment = require('../models/Appointment');

/**
 * Match workers to a shift
 * POST /api/scheduling/match-workers
 */
exports.matchWorkers = async (req, res) => {
  try {
    const { shiftId, organizationId, criteria } = req.body;

    if (!shiftId || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'shiftId and organizationId are required',
      });
    }

    // Get shift details
    const shift = await Appointment.findById(shiftId);
    if (!shift) {
      return res.status(404).json({
        success: false,
        message: 'Shift not found',
      });
    }

    // Get available workers in organization
    const workers = await User.find({
      organizationId,
      role: { $in: ['normal', 'worker'] },
      isActive: true,
    });

    // Find best matches
    const matches = shiftMatchingService.findBestMatches(
      shift,
      workers,
      criteria || {}
    );

    res.json({
      success: true,
      data: {
        shiftId,
        matches,
        totalMatches: matches.length,
      },
    });
  } catch (error) {
    console.error('Error matching workers:', error);
    res.status(500).json({
      success: false,
      message: 'Error matching workers',
      error: error.message,
    });
  }
};

/**
 * Auto-fill multiple shifts with optimal workers
 * POST /api/scheduling/auto-fill
 */
exports.autoFillShifts = async (req, res) => {
  try {
    const { shiftIds, organizationId, criteria } = req.body;

    if (!shiftIds || !Array.isArray(shiftIds) || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'shiftIds (array) and organizationId are required',
      });
    }

    // Get shifts
    const shifts = await Appointment.find({
      _id: { $in: shiftIds },
      organizationId,
    });

    if (shifts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No shifts found',
      });
    }

    // Get available workers
    const workers = await User.find({
      organizationId,
      role: { $in: ['normal', 'worker'] },
      isActive: true,
    });

    // Auto-fill shifts
    const result = shiftMatchingService.autoFillShifts(
      shifts,
      workers,
      criteria || {}
    );

    // Update shifts with assignments (in production, you'd save to database)
    // For now, just return the result
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error auto-filling shifts:', error);
    res.status(500).json({
      success: false,
      message: 'Error auto-filling shifts',
      error: error.message,
    });
  }
};

/**
 * Optimize route for a worker's shifts
 * POST /api/scheduling/optimize-route
 */
exports.optimizeRoute = async (req, res) => {
  try {
    const { workerId, date, organizationId } = req.body;

    if (!workerId || !date || !organizationId) {
      return res.status(400).json({
        success: false,
        message: 'workerId, date, and organizationId are required',
      });
    }

    // Get worker
    const worker = await User.findById(workerId);
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found',
      });
    }

    // Get worker's shifts for the date
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const shifts = await Appointment.find({
      organizationId,
      assignedWorker: workerId,
      'schedule.date': {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    });

    // Flatten shifts from schedule array
    const flatShifts = [];
    shifts.forEach(appointment => {
      if (appointment.schedule && Array.isArray(appointment.schedule)) {
        appointment.schedule.forEach(scheduleItem => {
          const shiftDate = new Date(scheduleItem.date);
          if (shiftDate >= startOfDay && shiftDate <= endOfDay) {
            flatShifts.push({
              _id: appointment._id,
              startTime: scheduleItem.startTime,
              endTime: scheduleItem.endTime,
              location: appointment.location || {},
              locationName: appointment.clientAddress || 'Unknown',
            });
          }
        });
      }
    });

    // Optimize route
    const optimization = shiftMatchingService.optimizeRoute(worker, flatShifts);

    res.json({
      success: true,
      data: optimization,
    });
  } catch (error) {
    console.error('Error optimizing route:', error);
    res.status(500).json({
      success: false,
      message: 'Error optimizing route',
      error: error.message,
    });
  }
};

/**
 * Get shift recommendations for a specific shift
 * GET /api/scheduling/recommendations/:shiftId
 */
exports.getShiftRecommendations = async (req, res) => {
  try {
    const { shiftId } = req.params;
    const { organizationId } = req.query;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organizationId query parameter is required',
      });
    }

    // Get shift
    const shift = await Appointment.findById(shiftId);
    if (!shift) {
      return res.status(404).json({
        success: false,
        message: 'Shift not found',
      });
    }

    // Get available workers
    const workers = await User.find({
      organizationId,
      role: { $in: ['normal', 'worker'] },
      isActive: true,
    });

    // Get top 5 matches
    const matches = shiftMatchingService.findBestMatches(shift, workers, {
      minMatchScore: 50,
    });

    // Get first schedule item for shift details
    const scheduleItem = shift.schedule && shift.schedule.length > 0
      ? shift.schedule[0]
      : {};

    const recommendation = {
      shiftId: shift._id,
      shiftDate: scheduleItem.date || new Date(),
      shiftTime: `${scheduleItem.startTime || 'N/A'} - ${scheduleItem.endTime || 'N/A'}`,
      service: shift.service || 'General Care',
      clientName: shift.clientName || 'Unknown Client',
      recommendedWorkers: matches.slice(0, 5),
      currentAssignment: shift.assignedWorker || null,
      isUrgent: shift.isUrgent || false,
    };

    res.json({
      success: true,
      data: recommendation,
    });
  } catch (error) {
    console.error('Error getting shift recommendations:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting shift recommendations',
      error: error.message,
    });
  }
};
