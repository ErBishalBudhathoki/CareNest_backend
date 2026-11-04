const TripService = require('../services/tripService');
const ProviderTravelService = require('../services/providerTravelService');
const { createLogger } = require('../utils/logger');
const catchAsync = require('../utils/catchAsync');
const logger = createLogger('TripController');

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
      clientId,
      startCoordinates,
      endCoordinates,
      routePath,
      propertyId,
      clientIds
    } = req.body;

    const parsedDistance = parseFloat(distance);

    // Milestone 3.2: clientIds supports multi-participant activity transport.
    // When present it must be an array of up to 20 participant id strings.
    const hasClientIds = clientIds !== undefined && clientIds !== null;
    if (
      hasClientIds &&
      (!Array.isArray(clientIds) ||
        clientIds.length > 20 ||
        clientIds.some((id) => typeof id !== 'string'))
    ) {
      return res.status(400).json({ 
        success: false, 
        code: 'VALIDATION_ERROR',
        message: 'clientIds must be an array of at most 20 participant IDs' 
      });
    }

    // Basic validation
    if (
      !date ||
      !startLocation ||
      !endLocation ||
      Number.isNaN(parsedDistance) ||
      parsedDistance < 0 ||
      !tripType
    ) {
      return res.status(400).json({ 
        success: false, 
        code: 'VALIDATION_ERROR',
        message: 'Missing required fields: date, startLocation, endLocation, distance, tripType' 
      });
    }

    const userId = req.user?.userId;
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
      distance: parsedDistance,
      tripType,
      clientId,
      startCoordinates,
      endCoordinates,
      routePath,
      propertyId,
      clientIds
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
    const { startDate, endDate, status, userId, clientId } = req.query;
    const organizationId = req.user?.organizationId;

    const filters = {
      organizationId,
      userId,
      clientId,
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
    const adminId = req.user?.userId;

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
    const adminId = req.user?.userId;

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
   * Create split activity transport charges for a multi-participant trip
   * (Milestone 3.2). Delegates to providerTravelService, which loads the trip,
   * splits its mileage evenly across the transported participants and
   * produces one 01_799_0107_1_1 charge per participant.
   * POST /api/trips/:tripId/transport-charges
   */
  createTransportCharges = catchAsync(async (req, res) => {
    const { tripId } = req.params;
    const { totalKm, clientIds, supportItemNumber, supportItemName, date } = req.body;
    const userId = req.user?.userId;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Unauthorized: User or Organization not identified'
      });
    }

    const input = {
      tripId,
      ...(totalKm !== undefined && totalKm !== null && { totalKm: parseFloat(totalKm) }),
      ...(clientIds !== undefined && { clientIds }),
      ...(supportItemNumber !== undefined && { supportItemNumber }),
      ...(supportItemName !== undefined && { supportItemName }),
      ...(date !== undefined && { date })
    };

    try {
      const charges = await ProviderTravelService.createActivityTransportCharges(
        organizationId,
        input,
        userId
      );

      logger.business('Trip Transport Charges Created', {
        event: 'trip_transport_charges_created',
        userId,
        organizationId,
        tripId,
        chargeCount: charges.length,
        timestamp: new Date().toISOString()
      });

      return res.status(201).json({
        success: true,
        code: 'TRANSPORT_CHARGES_CREATED',
        message: `Created ${charges.length} transport charge(s)`,
        data: { charges }
      });
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      return res.status(status).json({
        success: false,
        code: error?.code || 'TRANSPORT_CHARGES_FAILED',
        message: error?.message || 'Failed to create transport charges'
      });
    }
  });

  /**
   * Get trips for an employee
   * GET /api/trips/employee/:userId
   */
  getTripsByEmployee = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const { startDate, endDate, status } = req.query;
    const organizationId = req.user?.organizationId;

    const trips = await TripService.getTripsByEmployee(userId, {
      organizationId,
      startDate,
      endDate,
      status,
    });

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
