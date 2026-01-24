const WorkedTime = require('../models/WorkedTime');
const Client = require('../models/Client');
const logger = require('../config/logger');

class WorkedTimeService {
  /**
   * Get visit history for a specific client
   * @param {string} clientId - Client ID
   * @param {string} organizationId - Organization ID
   * @param {string} userEmail - User Email (optional, for filtering by user)
   * @returns {Promise<Array>} List of visits
   */
  async getVisitHistory(clientId, organizationId, userEmail) {
    try {
      // Verify client belongs to organization
      const clientDoc = await Client.findOne({
        _id: clientId,
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

      const visits = await WorkedTime.find(query)
        .sort({ createdAt: -1 });

      return {
        success: true,
        visits
      };

    } catch (error) {
      logger.error('Error getting visit history:', error);
      throw error;
    }
  }

  /**
   * Get recent visits for a user
   * @param {string} userEmail - User Email
   * @param {number} limit - Number of visits to return
   */
  async getRecentVisits(userEmail, limit = 5) {
    try {
      const visits = await WorkedTime.aggregate([
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
      ]);

      return {
        success: true,
        visits
      };

    } catch (error) {
      logger.error('Error getting recent visits:', error);
      throw error;
    }
  }
}

module.exports = new WorkedTimeService();
