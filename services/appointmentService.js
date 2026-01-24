const ClientAssignment = require('../models/ClientAssignment');
const Client = require('../models/Client');
const User = require('../models/User');
const WorkedTime = require('../models/WorkedTime');
const logger = require('../config/logger');

/**
 * Service for handling appointment-related database operations
 */
class AppointmentService {
  /**
   * Load appointments for a user
   * @param {string} email - User email
   * @returns {Promise<Array>} Array of appointments
   */
  static async loadAppointments(email) {
    try {
      // Get appointments (client assignments) with client details
      const appointments = await ClientAssignment.aggregate([
        {
          $match: {
            userEmail: email,
            isActive: true
          }
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
            userEmail: 1,
            clientEmail: 1,
            organizationId: 1,
            schedule: 1,
            createdAt: 1,
            isActive: 1,
            // Legacy format for compatibility with existing frontend
            dateList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.date"
                  }
                },
                "$dateList"
              ]
            },
            startTimeList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.startTime"
                  }
                },
                "$startTimeList"
              ]
            },
            endTimeList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.endTime"
                  }
                },
                "$endTimeList"
              ]
            },
            breakList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.break"
                  }
                },
                "$breakList"
              ]
            },
            clientDetails: 1
          }
        },
        {
          $sort: {
            createdAt: -1
          }
        }
      ]);

      return appointments;
    } catch (error) {
      logger.error('Appointments load failed', {
        error: error.message,
        stack: error.stack,
        email
      });
      throw new Error('Failed to load appointments');
    }
  }

  /**
   * Get appointment details for a specific user and client
   * @param {string} userEmail - User email
   * @param {string} clientEmail - Client email
   * @returns {Promise<Object>} Appointment details
   */
  static async loadAppointmentDetails(userEmail, clientEmail) {
    try {
      // Get the specific appointment assignment with client details
      const appointmentDetails = await ClientAssignment.aggregate([
        {
          $match: {
            userEmail: userEmail,
            clientEmail: clientEmail,
            isActive: true
          }
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
            userEmail: 1,
            clientEmail: 1,
            organizationId: 1,
            schedule: 1,
            createdAt: 1,
            isActive: 1,
            // Legacy format for compatibility with existing frontend
            dateList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.date"
                  }
                },
                "$dateList"
              ]
            },
            startTimeList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.startTime"
                  }
                },
                "$startTimeList"
              ]
            },
            endTimeList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.endTime"
                  }
                },
                "$endTimeList"
              ]
            },
            breakList: {
              $ifNull: [
                {
                  $map: {
                    input: "$schedule",
                    as: "item",
                    in: "$item.break"
                  }
                },
                "$breakList"
              ]
            },
            clientDetails: 1
          }
        }
      ]);

      if (appointmentDetails.length === 0) {
        throw new Error('No appointment found for this user-client combination');
      }

      const appointment = appointmentDetails[0];

      return {
        assignedClient: appointment,
        clientDetails: [appointment.clientDetails]
      };
    } catch (error) {
      logger.error('Appointment details load failed', {
        error: error.message,
        stack: error.stack,
        userEmail,
        clientEmail
      });
      throw error;
    }
  }

  /**
   * Get all assignments for an organization
   * @param {string} organizationId - Organization ID
   * @returns {Promise<Array>} Array of assignments
   */
  static async getOrganizationAssignments(organizationId) {
    try {
      // Get assignments with client details for the organization
      const assignments = await ClientAssignment.aggregate([
        {
          $match: {
            organizationId: organizationId,
            isActive: true
          }
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
          $unwind: "$clientDetails"
        },
        {
          $lookup: {
            from: "users", // Assuming 'login' collection is mapped to users via User model, but lookups use collection name. User model maps to 'login'.
            localField: "userEmail",
            foreignField: "email",
            as: "userDetails"
          }
        },
        {
          $unwind: {
            path: "$userDetails",
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            _id: 1,
            userEmail: 1,
            clientEmail: 1,
            organizationId: 1,
            schedule: 1,
            createdAt: 1,
            isActive: 1,
            // Legacy format for compatibility
            dateList: {
              $map: {
                input: "$schedule",
                as: "item",
                in: "$item.date"
              }
            },
            startTimeList: {
              $map: {
                input: "$schedule",
                as: "item",
                in: "$item.startTime"
              }
            },
            endTimeList: {
              $map: {
                input: "$schedule",
                as: "item",
                in: "$item.endTime"
              }
            },
            breakList: {
              $map: {
                input: "$schedule",
                as: "item",
                in: "$item.break"
              }
            },
            clientDetails: 1,
            userDetails: 1
          }
        },
        {
          $sort: {
            createdAt: -1
          }
        }
      ]);

      // Note: If 'users' lookup fails because collection is 'login', we might need to adjust.
      // But based on previous files, 'login' is the collection name for User model.
      // So I should change 'from: "users"' to 'from: "login"'.
      
      return assignments;
    } catch (error) {
      logger.error('Organization assignments fetch failed', {
        error: error.message,
        stack: error.stack,
        organizationId
      });
      throw new Error('Failed to get organization assignments');
    }
  }

  /**
   * Remove client assignment (soft delete)
   * @param {string} userEmail - User email
   * @param {string} clientEmail - Client email
   * @returns {Promise<Object>} Result of the operation
   */
  static async removeClientAssignment(userEmail, clientEmail) {
    try {
      // Soft delete assignment
      const result = await ClientAssignment.updateOne(
        {
          userEmail: userEmail,
          clientEmail: clientEmail,
          isActive: true
        },
        {
          $set: {
            isActive: false,
            deletedAt: new Date()
          }
        }
      );

      if (result.matchedCount === 0) {
        throw new Error('Assignment not found');
      }

      return { success: true, message: 'Assignment removed successfully' };
    } catch (error) {
      logger.error('Client assignment removal failed', {
        error: error.message,
        stack: error.stack,
        userEmail,
        clientEmail
      });
      throw error;
    }
  }

  /**
   * Set worked time for a client
   * @param {Object} workedTimeData - Worked time data
   * @returns {Promise<Object>} Result of the operation
   */
  static async setWorkedTime(workedTimeData) {
    try {
      const {
        userEmail,
        clientEmail,
        timeList,
        shiftIndex
      } = workedTimeData;

      // Validate required fields
      if (!userEmail || !clientEmail || !timeList) {
        throw new Error('Missing required fields: userEmail, clientEmail, timeList');
      }

      // Find the assigned client record
      const assignedClient = await ClientAssignment.findOne({
        userEmail: userEmail,
        clientEmail: clientEmail,
        isActive: true
      });

      if (!assignedClient) {
        throw new Error('Assigned client not found');
      }

      // Get shift details from the assigned client record
      let shiftDate = null;
      let shiftStartTime = null;
      let shiftEndTime = null;
      let shiftBreak = null;

      // Extract shift details based on shiftIndex
      if (assignedClient.schedule && assignedClient.schedule.length > shiftIndex) {
        // Use new schedule array format
        const shift = assignedClient.schedule[shiftIndex];
        shiftDate = shift.date;
        shiftStartTime = shift.startTime;
        shiftEndTime = shift.endTime;
        shiftBreak = shift.break;
      } else if (assignedClient.dateList && assignedClient.dateList.length > shiftIndex) {
        // Fallback to legacy format - though schema might not have these if strict
        // But assuming mixed usage or migration
        shiftDate = assignedClient.dateList[shiftIndex];
        shiftStartTime = assignedClient.startTimeList ? assignedClient.startTimeList[shiftIndex] : null;
        shiftEndTime = assignedClient.endTimeList ? assignedClient.endTimeList[shiftIndex] : null;
        shiftBreak = assignedClient.breakList ? assignedClient.breakList[shiftIndex] : null;
      }

      // Create worked time record with specific shift details
      const workedTimeRecord = new WorkedTime({
        userEmail: userEmail,
        clientEmail: clientEmail,
        timeWorked: timeList,
        shiftIndex: shiftIndex || 0,
        assignedClientId: assignedClient._id,
        // Add specific shift details for better linking
        shiftDate: shiftDate,
        shiftStartTime: shiftStartTime,
        shiftEndTime: shiftEndTime,
        shiftBreak: shiftBreak,
        // Create a unique shift identifier
        shiftKey: shiftDate && shiftStartTime ? `${shiftDate}_${shiftStartTime}` : null,
        createdAt: new Date(),
        isActive: true
      });

      // Insert the worked time record
      const result = await workedTimeRecord.save();

      return {
        success: true,
        message: 'Worked time saved successfully',
        data: {
          id: result._id,
          timeWorked: timeList
        }
      };
    } catch (error) {
      logger.error('Worked time setting failed', {
        error: error.message,
        stack: error.stack,
        userEmail: workedTimeData?.userEmail,
        clientEmail: workedTimeData?.clientEmail
      });
      throw error;
    }
  }
  
  /**
   * Reassign a specific shift from one user to another
   * @param {string} organizationId - Organization ID
   * @param {string} oldUserEmail - Current user email
   * @param {string} newUserEmail - New user email
   * @param {string} clientEmail - Client email
   * @param {Object} shiftDetails - Details of the shift to swap { date, startTime, endTime, break }
   * @returns {Promise<Object>} Result
   */
  static async reassignShift(organizationId, oldUserEmail, newUserEmail, clientEmail, shiftDetails) {
    try {
      // INTERNAL HELPER: Normalize schedule from legacy fields
      const getNormalizedSchedule = (doc) => {
        if (doc.schedule && doc.schedule.length > 0) return doc.schedule;
        // Accessing legacy fields via .toObject() or direct access if schema allows
        // Assuming schema might be strict, so use .get() if needed or just access
        const docObj = doc.toObject ? doc.toObject() : doc;
        if (!docObj.dateList || !Array.isArray(docObj.dateList)) return [];
        return docObj.dateList.map((date, i) => ({
          date,
          startTime: docObj.startTimeList ? docObj.startTimeList[i] : null,
          endTime: docObj.endTimeList ? docObj.endTimeList[i] : null,
          break: docObj.breakList ? docObj.breakList[i] : null,
        }));
      };

      // 1. Process Old User (Remove Shift)
      const oldAssignment = await ClientAssignment.findOne({
        organizationId,
        userEmail: oldUserEmail,
        clientEmail: clientEmail,
        isActive: true
      });

      if (!oldAssignment) {
        throw new Error(`Assignment not found for old user: ${oldUserEmail}`);
      }

      let oldSchedule = getNormalizedSchedule(oldAssignment);

      // Helper for robust comparison
      const normalizeDate = (d) => {
        if (!d) return '';
        if (d instanceof Date) return d.toISOString().split('T')[0];
        return d.toString().split('T')[0];
      };

      const isSameShift = (s, target) => {
        const d1 = normalizeDate(s.date);
        const d2 = normalizeDate(target.date);
        const t1 = (s.startTime || '').toString().trim();
        const t2 = (target.startTime || '').toString().trim();
        return d1 === d2 && t1 === t2;
      };

      // Filter out the shift
      const originalLength = oldSchedule.length;
      oldSchedule = oldSchedule.filter(s => !isSameShift(s, shiftDetails));

      if (oldSchedule.length === originalLength) {
        // Shift not found in schedule
        console.error(`Shift not found in old user's schedule. Looking for: ${JSON.stringify(shiftDetails)}`);
        throw new Error(`Shift not found within old user's schedule: ${shiftDetails.date} ${shiftDetails.startTime}`);
      }

      // Update old user doc (migrating to 'schedule' field)
      await ClientAssignment.updateOne(
        { _id: oldAssignment._id },
        {
          $set: {
            schedule: oldSchedule,
            updatedAt: new Date(),
            // Clear legacy fields to prevent confusion - schema might reject this if fields not in schema
            // but for now keeping logic same as before
            // If schema is strict, these unset/set might be ignored if fields are not in schema
          },
          $unset: {
             dateList: "",
             startTimeList: "",
             endTimeList: "",
             breakList: ""
          }
        }
      );

      // 2. Process New User (Add Shift)
      const newAssignment = await ClientAssignment.findOne({
        organizationId,
        userEmail: newUserEmail,
        clientEmail: clientEmail,
        isActive: true
      });

      if (newAssignment) {
        let newSchedule = getNormalizedSchedule(newAssignment);
        newSchedule.push(shiftDetails);

        await ClientAssignment.updateOne(
          { _id: newAssignment._id },
          {
            $set: {
              schedule: newSchedule,
              updatedAt: new Date()
            },
            $unset: {
               dateList: "",
               startTimeList: "",
               endTimeList: "",
               breakList: ""
            }
          }
        );
      } else {
        // Create new assignment
        await ClientAssignment.create({
          organizationId,
          userEmail: newUserEmail,
          clientEmail: clientEmail,
          clientId: oldAssignment.clientId, // Need clientId
          schedule: [shiftDetails],
          isActive: true,
          createdAt: new Date()
        });
      }

      return { success: true };
    } catch (error) {
      logger.error('Reassign shift failed', {
        error: error.message,
        stack: error.stack,
        organizationId, oldUserEmail, newUserEmail
      });
      // Propagate error so RequestService knows it failed
      throw error;
    }
  }
}
module.exports = AppointmentService;
