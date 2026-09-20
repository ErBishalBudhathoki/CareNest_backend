const appointmentService = require('../services/appointmentService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

/**
 * IDOR guard: appointment lookups are keyed by email, so the caller must
 * be the subject or hold an admin/owner role. Prevents any authenticated
 * user from pulling another user's roster by email.
 */
function canAccessUserEmail(req, email) {
  const callerEmail = req.user && req.user.email;
  if (callerEmail && email && String(callerEmail).toLowerCase() === String(email).toLowerCase()) {
    return true;
  }
  const roles = (req.user && (req.user.roles || [req.user.role]) || []).map((r) =>
    String(r || '').toLowerCase(),
  );
  return roles.includes('admin') || roles.includes('owner');
}

function forbiddenEmail(res) {
  return res.status(403).json({
    success: false,
    error: 'Access denied to this user\u2019s appointments',
    data: []
  });
}

/**
 * Controller for handling appointment-related HTTP requests
 */
class AppointmentController {
  /**
   * Load appointments for a user
   * GET /loadAppointments/:email
   */
  static loadAppointments = catchAsync(async (req, res) => {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email parameter is required',
        data: []
      });
    }

    if (!canAccessUserEmail(req, email)) {
      return forbiddenEmail(res);
    }
    
    const appointments = await appointmentService.loadAppointments(email);
    
    res.status(200).json({
      success: true,
      data: appointments
    });
  });

  /**
   * Get appointment details for a specific user and client
   * GET /loadAppointmentDetails/:userEmail/:clientEmail
   */
  static loadAppointmentDetails = catchAsync(async (req, res) => {
    const { userEmail, clientEmail } = req.params;
    
    if (!userEmail || !clientEmail) {
      return res.status(400).json({
        success: false,
        error: 'Both userEmail and clientEmail parameters are required'
      });
    }

    if (!canAccessUserEmail(req, userEmail)) {
      return forbiddenEmail(res);
    }
    
    const appointmentDetails = await appointmentService.loadAppointmentDetails(userEmail, clientEmail);
    
    res.status(200).json({
      success: true,
      data: appointmentDetails
    });
  });

  /**
   * Get all assignments for an organization
   * GET /getOrganizationAssignments/:organizationId
   */
  static getOrganizationAssignments = catchAsync(async (req, res) => {
    const { organizationId } = req.params;
    
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID parameter is required'
      });
    }
    
    const assignments = await appointmentService.getOrganizationAssignments(organizationId);
    
    res.status(200).json({
      success: true,
      assignments: assignments
    });
  });

  /**
   * Remove client assignment
   * DELETE /removeClientAssignment
   * Accepts query parameters or body (for flexibility)
   */
  static removeClientAssignment = catchAsync(async (req, res) => {
    // Check body first, then query
    const userEmail = req.body.userEmail || req.query.userEmail;
    const clientEmail = req.body.clientEmail || req.query.clientEmail;
    
    if (!userEmail || !clientEmail) {
      return res.status(400).json({
        success: false,
        error: 'Both userEmail and clientEmail are required'
      });
    }
    
    const result = await appointmentService.removeClientAssignment(userEmail, clientEmail);
    
    res.status(200).json(result);
  });

  /**
   * Set worked time for a client
   * POST /setWorkedTime
   */
  static setWorkedTime = catchAsync(async (req, res) => {
    const parsedShiftIndex =
      Number.isInteger(req.body.shiftIndex) ? req.body.shiftIndex : parseInt(req.body.shiftIndex, 10);

    const {
      userEmail,
      clientEmail,
      timeList,
      shiftIndex,
      date,
      startTime,
      endTime,
      breakDuration
    } = req.body;
    
    const workedTimeData = {
      userEmail,
      clientEmail,
      timeList,
      shiftIndex: Number.isNaN(parsedShiftIndex) ? 0 : parsedShiftIndex,
      shiftDate: date,
      shiftStartTime: startTime,
      shiftEndTime: endTime,
      shiftBreak: breakDuration
    };
    
    const result = await appointmentService.setWorkedTime(workedTimeData);
    
    res.status(200).json(result);
  });
}

module.exports = AppointmentController;
