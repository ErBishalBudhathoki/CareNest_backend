const TripService = require('../services/tripService');
const logger = require('../utils/logger');

class TripController {
  
  /**
   * Create a new trip
   */
  async createTrip(req, res) {
    try {
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
          message: 'Missing required fields: date, startLocation, endLocation, distance, tripType' 
        });
      }

      // Assuming user ID and Organization ID come from auth middleware (e.g. req.user)
      // If not, they might be in body, but usually auth middleware handles this.
      // I'll assume req.user exists as per standard Express patterns.
      const userId = req.user ? req.user.id : req.body.userId;
      const organizationId = req.user ? req.user.organizationId : req.body.organizationId;

      if (!userId || !organizationId) {
        return res.status(401).json({ 
          success: false, 
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
      
      return res.status(201).json({
        success: true,
        message: 'Trip created successfully',
        data: result
      });

    } catch (error) {
      logger.error('Error creating trip', { error: error.message });
      return res.status(500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Get all trips (Admin)
   */
  async getAllTrips(req, res) {
    try {
      // Allow filtering by date range, status, and userId via query params
      const { startDate, endDate, status, userId } = req.query;
      const organizationId = req.user ? req.user.organizationId : req.query.organizationId;

      const filters = {
        organizationId,
        userId,
        startDate,
        endDate,
        status
      };

      const trips = await TripService.getAllTrips(filters);

      return res.status(200).json({
        success: true,
        data: trips
      });

    } catch (error) {
      logger.error('Error fetching all trips', { error: error.message });
      return res.status(500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Update trip details
   */
  async updateTripDetails(req, res) {
    try {
      const { tripId } = req.params;
      const updateData = req.body;
      const adminId = req.user ? req.user.id : null;

      const success = await TripService.updateTripDetails(tripId, updateData, adminId);

      if (!success) {
        return res.status(404).json({ success: false, message: 'Trip not found or update failed' });
      }

      return res.status(200).json({
        success: true,
        message: 'Trip details updated successfully'
      });

    } catch (error) {
      logger.error('Error updating trip details', { error: error.message });
      return res.status(500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Approve or Reject a trip
   */
  async updateTripStatus(req, res) {
    try {
      const { tripId } = req.params;
      const { status } = req.body;
      const adminId = req.user ? req.user.id : null;

      if (!status) {
        return res.status(400).json({ success: false, message: 'Status is required' });
      }

      const success = await TripService.updateTripStatus(tripId, status, adminId);

      if (!success) {
        return res.status(404).json({ success: false, message: 'Trip not found or update failed' });
      }

      return res.status(200).json({
        success: true,
        message: `Trip status updated to ${status}`
      });

    } catch (error) {
      logger.error('Error updating trip status', { error: error.message });
      return res.status(500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Get trips for an employee
   */
  async getTripsByEmployee(req, res) {
    try {
      const { userId } = req.params;
      // Allow filtering by date range and status via query params
      const { startDate, endDate, status } = req.query;

      // Security check: Ensure requester is the user or an admin of the same org
      // (Skipping complex auth logic for now, assuming middleware handles route protection)

      const trips = await TripService.getTripsByEmployee(userId, { startDate, endDate, status });

      return res.status(200).json({
        success: true,
        data: trips
      });

    } catch (error) {
      logger.error('Error fetching employee trips', { error: error.message });
      return res.status(500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }

  /**
   * Get Enhanced Invoice Analytics
   */
  async getInvoiceAnalytics(req, res) {
    try {
      const { startDate, endDate } = req.query;
      const organizationId = req.user ? req.user.organizationId : req.query.organizationId;

      if (!startDate || !endDate || !organizationId) {
        return res.status(400).json({
          success: false,
          message: 'startDate, endDate, and organizationId are required'
        });
      }

      // Run both aggregations in parallel
      const [reimbursements, clientBillings] = await Promise.all([
        TripService.calculateReimbursement(organizationId, startDate, endDate),
        TripService.calculateClientBilling(organizationId, startDate, endDate)
      ]);

      return res.status(200).json({
        success: true,
        data: {
          employeeReimbursements: reimbursements,
          clientBillings: clientBillings
        }
      });

    } catch (error) {
      logger.error('Error calculating invoice analytics', { error: error.message });
      return res.status(500).json({
        success: false,
        message: error.message || 'Internal server error'
      });
    }
  }
}

module.exports = new TripController();
