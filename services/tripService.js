const mongoose = require('mongoose');
const Trip = require('../models/Trip');
const Organization = require('../models/Organization');

class TripService {
  /**
   * Create a new trip
   */
  async createTrip(tripData) {
    try {
      const { 
        organizationId, 
        userId, 
        date, 
        startLocation, 
        endLocation, 
        distance, 
        tripType, 
        clientId 
      } = tripData;

      // Business Logic for Reimbursable/Billable
      let isReimbursable = false;
      let isBillable = false;

      if (tripType === 'BETWEEN_CLIENTS') {
        isReimbursable = true;
        isBillable = false;
      } else if (tripType === 'WITH_CLIENT') {
        isReimbursable = true;
        isBillable = true;
        if (!clientId) {
          throw new Error('Client ID is required for trips with client');
        }
      } else if (tripType === 'COMMUTE') {
        isReimbursable = false;
        isBillable = false;
      }

      const tripDoc = {
        organizationId,
        userId,
        clientId: clientId || null,
        date: new Date(date),
        startLocation,
        endLocation,
        distance: Number(distance),
        tripType,
        status: 'PENDING',
        adminApprovalStatus: 'PENDING',
        isReimbursable,
        isBillable,
      };

      const newTrip = await Trip.create(tripDoc);
      
      return {
        tripId: newTrip._id.toString(),
        ...newTrip.toObject()
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all trips (Admin)
   */
  async getAllTrips(filters = {}) {
    try {
      const query = {};
      
      if (filters.organizationId) {
        query.organizationId = new mongoose.Types.ObjectId(filters.organizationId);
      }

      if (filters.userId) {
        query.userId = new mongoose.Types.ObjectId(filters.userId);
      }

      if (filters.startDate && filters.endDate) {
        query.date = {
          $gte: new Date(filters.startDate),
          $lte: new Date(filters.endDate)
        };
      }

      if (filters.status) {
        query.status = filters.status;
      }

      const trips = await Trip.aggregate([
        { $match: query },
        { $sort: { date: -1 } },
        // Join with users to get employee name
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            pipeline: [
              { $project: { firstName: 1, lastName: 1, email: 1 } }
            ],
            as: "employee"
          }
        },
        { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } }
      ]);
        
      return trips;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update trip details (Admin)
   */
  async updateTripDetails(tripId, updateData, adminId) {
    try {
      const { distance, clientId, status, tripType } = updateData;
      
      const updateFields = {
        updatedAt: new Date()
      };

      if (distance !== undefined) updateFields.distance = Number(distance);
      if (clientId !== undefined) updateFields.clientId = clientId;
      if (tripType !== undefined) updateFields.tripType = tripType;
      
      // Recalculate billable/reimbursable if type changes
      if (tripType) {
        if (tripType === 'BETWEEN_CLIENTS') {
          updateFields.isReimbursable = true;
          updateFields.isBillable = false;
        } else if (tripType === 'WITH_CLIENT') {
          updateFields.isReimbursable = true;
          updateFields.isBillable = true;
        } else if (tripType === 'COMMUTE') {
          updateFields.isReimbursable = false;
          updateFields.isBillable = false;
        }
      }

      if (status) {
        if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
          throw new Error('Invalid status');
        }
        updateFields.status = status;
        updateFields.adminApprovalStatus = status;
        if (status === 'APPROVED' || status === 'REJECTED') {
          updateFields.approvedBy = adminId;
        }
      }

      const result = await Trip.updateOne(
        { _id: tripId },
        { $set: updateFields }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Approve or Reject a trip
   */
  async updateTripStatus(tripId, status, adminId) {
    try {
      if (!['APPROVED', 'REJECTED'].includes(status)) {
        throw new Error('Invalid status');
      }

      const result = await Trip.updateOne(
        { _id: tripId },
        { 
          $set: { 
            status: status,
            adminApprovalStatus: status, // Syncing for now
            approvedBy: adminId,
            updatedAt: new Date()
          } 
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get trips for an employee
   */
  async getTripsByEmployee(userId, filters = {}) {
    try {
      const query = { userId: userId };
      
      if (filters.startDate && filters.endDate) {
        query.date = {
          $gte: new Date(filters.startDate),
          $lte: new Date(filters.endDate)
        };
      }

      if (filters.status) {
        query.status = filters.status;
      }

      const trips = await Trip.find(query).sort({ date: -1 });
      return trips;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get billable trips for a client in a date range
   */
  async getBillableTrips(clientId, startDate, endDate) {
    try {
      const query = {
        clientId: clientId,
        isBillable: true,
        status: 'APPROVED',
        date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };

      const trips = await Trip.find(query).sort({ date: 1 });
      return trips;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get reimbursable trips for an employee in a date range
   */
  async getReimbursableTrips(userId, startDate, endDate) {
    try {
      const query = {
        userId: userId,
        isReimbursable: true,
        status: 'APPROVED',
        date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };

      const trips = await Trip.find(query).sort({ date: 1 });
      return trips;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Calculate Employee Reimbursements (Aggregation)
   * Rule: Approved trips (BETWEEN_CLIENTS or WITH_CLIENT) * Organization Reimbursement Rate
   */
  async calculateReimbursement(organizationId, startDate, endDate) {
    try {


      // Re-implementing the original logic but with Mongoose models
      // We can fetch the organization rate first to simplify the aggregation
      const org = await Organization.findById(organizationId, 'reimbursementRate');
      const rate = org ? (org.reimbursementRate || 0) : 0;

      const tripsAggregation = await Trip.aggregate([
        {
          $match: {
            organizationId: new mongoose.Types.ObjectId(organizationId),
            status: 'APPROVED',
            tripType: { $in: ['BETWEEN_CLIENTS', 'WITH_CLIENT'] },
            date: {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
            }
          }
        },
        {
          $group: {
            _id: "$userId",
            totalDistance: { $sum: "$distance" },
            tripCount: { $sum: 1 }
          }
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            pipeline: [
              { $project: { firstName: 1, lastName: 1, email: 1 } }
            ],
            as: "employee"
          }
        },
        { $unwind: "$employee" },
        {
          $project: {
            employeeId: "$_id",
            employeeName: { $concat: ["$employee.firstName", " ", "$employee.lastName"] },
            totalDistance: 1,
            tripCount: 1,
            rateApplied: { $literal: rate },
            totalReimbursement: { 
              $multiply: [
                "$totalDistance", 
                rate
              ] 
            }
          }
        }
      ]);

      return tripsAggregation;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Calculate Client Billing (Aggregation)
   * Rule: Approved trips (WITH_CLIENT only) * Organization Client Billing Rate
   */
  async calculateClientBilling(organizationId, startDate, endDate) {
    try {
      // Fetch organization rate first
      const org = await Organization.findById(organizationId, 'clientBillingRate');
      const rate = org ? (org.clientBillingRate || 0) : 0;

      const pipeline = [
        {
          $match: {
            organizationId: new mongoose.Types.ObjectId(organizationId),
            status: 'APPROVED',
            tripType: 'WITH_CLIENT',
            date: {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
            }
          }
        },
        {
          $group: {
            _id: "$clientId",
            totalDistance: { $sum: "$distance" },
            tripCount: { $sum: 1 }
          }
        },
        // Lookup Client details
        {
           $lookup: {
             from: "clients",
             localField: "_id",
             foreignField: "_id",
             as: "client"
           }
        },
        // We might want to unwind if we want client details, but the original just projected ID.
        // Let's assume we want to return what the original did.
        {
          $project: {
            clientId: "$_id",
            totalDistance: 1,
            tripCount: 1,
            rateApplied: { $literal: rate },
            totalBill: { 
              $multiply: [
                "$totalDistance", 
                rate
              ] 
            }
          }
        }
      ];

      return await Trip.aggregate(pipeline);
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new TripService();
