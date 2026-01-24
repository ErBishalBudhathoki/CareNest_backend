const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const logger = require('../config/logger');

class WorkedTimeService {
  constructor() {
    this.uri = process.env.MONGODB_URI;
  }

  /**
   * Get visit history for a specific client
   * @param {string} clientId - Client ID
   * @param {string} organizationId - Organization ID
   * @param {string} userEmail - User Email (optional, for filtering by user)
   * @returns {Promise<Array>} List of visits
   */
  async getVisitHistory(clientId, organizationId, userEmail) {
    const client = new MongoClient(this.uri, { tls: true, family: 4, serverApi: ServerApiVersion.v1 });
    try {
      await client.connect();
      const db = client.db("Invoice");

      // Verify client belongs to organization
      const clientDoc = await db.collection("clients").findOne({
        _id: new ObjectId(clientId),
        organizationId: organizationId,
        isActive: true
      });

      if (!clientDoc) {
        throw new Error('Client not found or access denied');
      }

      const query = {
        clientEmail: clientDoc.clientEmail,
        isActive: true
      };

      if (userEmail) {
        query.userEmail = userEmail;
      }

      const visits = await db.collection("workedTime").find(query)
        .sort({ createdAt: -1 })
        .toArray();

      return {
        success: true,
        visits
      };

    } finally {
      await client.close();
    }
  }

  /**
   * Get recent visits for a user
   * @param {string} userEmail - User Email
   * @param {number} limit - Number of visits to return
   */
  async getRecentVisits(userEmail, limit = 5) {
    const client = new MongoClient(this.uri, { tls: true, family: 4, serverApi: ServerApiVersion.v1 });
    try {
      await client.connect();
      const db = client.db("Invoice");

      const visits = await db.collection("workedTime").aggregate([
        {
          $match: {
            userEmail: userEmail,
            isActive: true
          }
        },
        {
          $sort: { createdAt: -1 }
        },
        {
          $limit: limit
        },
        {
          $lookup: {
            from: "clients",
            localField: "clientEmail",
            foreignField: "clientEmail",
            as: "clientDetails"
          }
        },
        {
          $unwind: {
            path: "$clientDetails",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            _id: 1,
            timeWorked: 1,
            createdAt: 1,
            shiftDate: 1,
            shiftStartTime: 1,
            shiftEndTime: 1,
            clientName: { 
              $concat: ["$clientDetails.clientFirstName", " ", "$clientDetails.clientLastName"] 
            }
          }
        }
      ]).toArray();

      return {
        success: true,
        visits
      };

    } finally {
      await client.close();
    }
  }
}

module.exports = new WorkedTimeService();
