const appointmentService = require('../services/appointmentService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

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
    const {
      'User-Email': userEmail,
      'Client-Email': clientEmail,
      'TimeList': timeList,
      shiftIndex
    } = req.body;
    
    const workedTimeData = {
      userEmail,
      clientEmail,
      timeList,
      shiftIndex
    };
    
    const result = await appointmentService.setWorkedTime(workedTimeData);
    
    res.status(200).json(result);
  });
}

module.exports = AppointmentController;
