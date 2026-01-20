const { MongoClient, ObjectId } = require('mongodb');
const OrganizationService = require('./organizationService');
const logger = require('../utils/logger'); // Assuming logger exists, if not I'll remove it later or check first.
// Actually I'll skip logger for now to avoid errors if it doesn't exist, or use console.error

class TripService {
  constructor() {
    this.dbName = "Invoice";
  }

  async getDbConnection() {
    const client = new MongoClient(process.env.MONGODB_URI, { tls: true, family: 4 });
    await client.connect();
    const db = client.db(this.dbName);
    
    // Ensure indexes
    await this.ensureIndexes(db);
    
    return { client, db };
  }

  async ensureIndexes(db) {
    try {
       await db.collection("trips").createIndex({ userId: 1, date: -1 });
       await db.collection("trips").createIndex({ organizationId: 1, date: -1 });
       await db.collection("trips").createIndex({ status: 1 });
       await db.collection("trips").createIndex({ isReimbursable: 1 });
    } catch (e) {
       // Ignore index exists errors
    }
  }

  /**
   * Create a new trip
   */
  async createTrip(tripData) {
    const { client, db } = await this.getDbConnection();
    
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
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection("trips").insertOne(tripDoc);
      
      return {
        tripId: result.insertedId.toString(),
        ...tripDoc
      };
    } finally {
      await client.close();
    }
  }

  /**
   * Get all trips (Admin)
   */
  async getAllTrips(filters = {}) {
    const { client, db } = await this.getDbConnection();
    
    try {
      const query = {};
      
      if (filters.organizationId) {
        query.organizationId = filters.organizationId;
      }

      if (filters.userId) {
        query.userId = filters.userId;
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

      const trips = await db.collection("trips")
        .aggregate([
          { $match: query },
          { $sort: { date: -1 } },
          // Join with users to get employee name
          {
            $lookup: {
              from: "users",
              let: { userId: "$userId" },
              pipeline: [
                { $match: { $expr: { $eq: ["$_id", { $toObjectId: "$$userId" }] } } },
                { $project: { firstName: 1, lastName: 1, email: 1 } }
              ],
              as: "employee"
            }
          },
          { $unwind: { path: "$employee", preserveNullAndEmptyArrays: true } }
        ])
        .toArray();
        
      return trips;
    } finally {
      await client.close();
    }
  }

  /**
   * Update trip details (Admin)
   */
  async updateTripDetails(tripId, updateData, adminId) {
    const { client, db } = await this.getDbConnection();
    
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

      const result = await db.collection("trips").updateOne(
        { _id: new ObjectId(tripId) },
        { $set: updateFields }
      );

      return result.modifiedCount > 0;
    } finally {
      await client.close();
    }
  }

  /**
   * Approve or Reject a trip
   */
  async updateTripStatus(tripId, status, adminId) {
    const { client, db } = await this.getDbConnection();
    
    try {
      if (!['APPROVED', 'REJECTED'].includes(status)) {
        throw new Error('Invalid status');
      }

      const result = await db.collection("trips").updateOne(
        { _id: new ObjectId(tripId) },
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
    } finally {
      await client.close();
    }
  }

  /**
   * Get trips for an employee
   */
  async getTripsByEmployee(userId, filters = {}) {
    const { client, db } = await this.getDbConnection();
    
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

      const trips = await db.collection("trips").find(query).sort({ date: -1 }).toArray();
      return trips;
    } finally {
      await client.close();
    }
  }

  /**
   * Get billable trips for a client in a date range
   */
  async getBillableTrips(clientId, startDate, endDate) {
    const { client, db } = await this.getDbConnection();
    
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

      const trips = await db.collection("trips").find(query).sort({ date: 1 }).toArray();
      return trips;
    } finally {
      await client.close();
    }
  }

  /**
   * Get reimbursable trips for an employee in a date range
   */
  async getReimbursableTrips(userId, startDate, endDate) {
    const { client, db } = await this.getDbConnection();
    
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

      const trips = await db.collection("trips").find(query).sort({ date: 1 }).toArray();
      return trips;
    } finally {
      await client.close();
    }
  }
  /**
   * Calculate Employee Reimbursements (Aggregation)
   * Rule: Approved trips (BETWEEN_CLIENTS or WITH_CLIENT) * Organization Reimbursement Rate
   */
  async calculateReimbursement(organizationId, startDate, endDate) {
    const { client, db } = await this.getDbConnection();
    
    try {
      const pipeline = [
        // 1. Match relevant trips
        {
          $match: {
            organizationId: organizationId,
            status: 'APPROVED',
            tripType: { $in: ['BETWEEN_CLIENTS', 'WITH_CLIENT'] },
            date: {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
            }
          }
        },
        // 2. Group by Employee
        {
          $group: {
            _id: "$userId",
            totalDistance: { $sum: "$distance" },
            tripCount: { $sum: 1 }
          }
        },
        // 3. Lookup Organization to get rate
        {
          $lookup: {
            from: "organizations",
            let: { orgId: { $toObjectId: organizationId } }, // Ensure ObjectId type matching
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$orgId"] } } },
              { $project: { reimbursementRate: 1 } }
            ],
            as: "organization"
          }
        },
        { $unwind: "$organization" },
        // 4. Lookup User to get details
        {
          $lookup: {
            from: "users",
            let: { userId: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", { $toObjectId: "$$userId" }] } } },
              { $project: { firstName: 1, lastName: 1, email: 1 } }
            ],
            as: "employee"
          }
        },
        { $unwind: "$employee" },
        // 5. Calculate Total Amount
        {
          $project: {
            employeeId: "$_id",
            employeeName: { $concat: ["$employee.firstName", " ", "$employee.lastName"] },
            totalDistance: 1,
            tripCount: 1,
            rateApplied: { $ifNull: ["$organization.reimbursementRate", 0] },
            totalReimbursement: { 
              $multiply: [
                "$totalDistance", 
                { $ifNull: ["$organization.reimbursementRate", 0] }
              ] 
            }
          }
        }
      ];

      return await db.collection("trips").aggregate(pipeline).toArray();
    } finally {
      await client.close();
    }
  }

  /**
   * Calculate Client Billing (Aggregation)
   * Rule: Approved trips (WITH_CLIENT only) * Organization Client Billing Rate
   */
  async calculateClientBilling(organizationId, startDate, endDate) {
    const { client, db } = await this.getDbConnection();
    
    try {
      const pipeline = [
        // 1. Match relevant trips
        {
          $match: {
            organizationId: organizationId,
            status: 'APPROVED',
            tripType: 'WITH_CLIENT',
            date: {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
            }
          }
        },
        // 2. Group by Client
        {
          $group: {
            _id: "$clientId",
            totalDistance: { $sum: "$distance" },
            tripCount: { $sum: 1 }
          }
        },
        // 3. Lookup Organization to get rate
        {
          $lookup: {
            from: "organizations",
            let: { orgId: { $toObjectId: organizationId } },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$orgId"] } } },
              { $project: { clientBillingRate: 1 } }
            ],
            as: "organization"
          }
        },
        { $unwind: "$organization" },
        // 4. Lookup Client details (assuming clients collection exists)
        // If clientId is just a string name, this might fail, but assuming ID reference pattern
        // For robustness, if clientId is not an ObjectId, we might just project it as name.
        // Let's assume it's a name or ID string. We'll project it directly.
        {
          $project: {
            clientId: "$_id",
            totalDistance: 1,
            tripCount: 1,
            rateApplied: { $ifNull: ["$organization.clientBillingRate", 0] },
            totalBill: { 
              $multiply: [
                "$totalDistance", 
                { $ifNull: ["$organization.clientBillingRate", 0] }
              ] 
            }
          }
        }
      ];

      return await db.collection("trips").aggregate(pipeline).toArray();
    } finally {
      await client.close();
    }
  }
}

module.exports = new TripService();
