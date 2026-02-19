const TripService = require('../services/tripService');
const logger = require('../utils/logger');
const catchAsync = require('../utils/catchAsync');

class TripController {
  
  /**
   * Create a new trip
   * POST /api/trips
   */
  createTrip = catchAsync(async (req, res) => {
    const { 
      date, 
      startLocation, 
      endLocation, 
      distance, 
      tripType, 
      clientId 
    } = req.body;

    // Basic validation
    if (!date || !startLocation || !endLocation || !distance || !tripType) {
      return res.status(400).json({ 
        success: false, 
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: date, startLocation, endLocation, distance, tripType' 
      });
    }

    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      return res.status(401).json({ 
        success: false, 
        code: 'UNAUTHORIZED',
        message: 'Unauthorized: User or Organization not identified' 
      });
    }

    const tripData = {
      organizationId,
      userId,
      date,
      startLocation,
      endLocation,
      distance,
      tripType,
      clientId
    };

    const result = await TripService.createTrip(tripData);
    
    logger.business('Trip Created', {
      event: 'trip_created',
      userId,
      organizationId,
      tripId: result?._id?.toString(),
      distance,
      tripType,
      timestamp: new Date().toISOString()
    });
    
    return res.status(201).json({
      success: true,
      code: 'TRIP_CREATED',
      message: 'Trip created successfully',
      data: result
    });
  });

  /**
   * Get all trips (Admin)
   * GET /api/trips
   */
  getAllTrips = catchAsync(async (req, res) => {
    const { startDate, endDate, status, userId } = req.query;
    const organizationId = req.user?.organizationId;

    const filters = {
      organizationId,
      userId,
      startDate,
      endDate,
      status
    };

    const trips = await TripService.getAllTrips(filters);

    logger.business('Trips Retrieved (Admin)', {
      event: 'trips_retrieved_admin',
      organizationId,
      count: trips.length,
      filters: Object.keys(filters).filter(k => filters[k]),
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'TRIPS_RETRIEVED',
      data: trips
    });
  });

  /**
   * Update trip details
   * PATCH /api/trips/:tripId
   */
  updateTripDetails = catchAsync(async (req, res) => {
    const { tripId } = req.params;
    const updateData = req.body;
    const adminId = req.user?.id;

    const success = await TripService.updateTripDetails(tripId, updateData, adminId);

    if (!success) {
      return res.status(404).json({ 
        success: false, 
        code: 'TRIP_NOT_FOUND',
        message: 'Trip not found or update failed' 
      });
    }

    logger.business('Trip Details Updated', {
      event: 'trip_details_updated',
      tripId,
      adminId,
      updatedFields: Object.keys(updateData),
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'TRIP_UPDATED',
      message: 'Trip details updated successfully'
    });
  });

  /**
   * Approve or Reject a trip
   * PATCH /api/trips/:tripId/status
   */
  updateTripStatus = catchAsync(async (req, res) => {
    const { tripId } = req.params;
    const { status } = req.body;
    const adminId = req.user?.id;

    if (!status) {
      return res.status(400).json({ 
        success: false, 
        code: 'VALIDATION_ERROR',
        message: 'Status is required' 
      });
    }

    const success = await TripService.updateTripStatus(tripId, status, adminId);

    if (!success) {
      return res.status(404).json({ 
        success: false, 
        code: 'TRIP_NOT_FOUND',
        message: 'Trip not found or update failed' 
      });
    }

    logger.business('Trip Status Updated', {
      event: 'trip_status_updated',
      tripId,
      adminId,
      status,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'TRIP_STATUS_UPDATED',
      message: `Trip status updated to ${status}`
    });
  });

  /**
   * Get trips for an employee
   * GET /api/trips/employee/:userId
   */
  getTripsByEmployee = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const { startDate, endDate, status } = req.query;

    const trips = await TripService.getTripsByEmployee(userId, { startDate, endDate, status });

    logger.business('Employee Trips Retrieved', {
      event: 'trips_retrieved_employee',
      userId,
      count: trips.length,
      dateRange: { startDate, endDate },
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'EMPLOYEE_TRIPS_RETRIEVED',
      data: trips
    });
  });

  /**
   * Get Enhanced Invoice Analytics
   * GET /api/trips/analytics
   */
  getInvoiceAnalytics = catchAsync(async (req, res) => {
    const { startDate, endDate } = req.query;
    const organizationId = req.user?.organizationId;

    if (!startDate || !endDate || !organizationId) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'startDate, endDate, and organizationId are required'
      });
    }

    const [reimbursements, clientBillings] = await Promise.all([
      TripService.calculateReimbursement(organizationId, startDate, endDate),
      TripService.calculateClientBilling(organizationId, startDate, endDate)
    ]);

    logger.business('Trip Analytics Retrieved', {
      event: 'trip_analytics_retrieved',
      organizationId,
      dateRange: { startDate, endDate },
      reimbursementCount: reimbursements.length,
      billingCount: clientBillings.length,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      code: 'ANALYTICS_RETRIEVED',
      data: {
        employeeReimbursements: reimbursements,
        clientBillings: clientBillings
      }
    });
  });
}

module.exports = new TripController();
