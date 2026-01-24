const mongoose = require('mongoose');
const Client = require('../models/Client');
const User = require('../models/User');
const ClientAssignment = require('../models/ClientAssignment');
const CustomPricing = require('../models/CustomPricing');
const auditService = require('./auditService');
const { processCustomPricing } = require('../utils/pricingHelpers');

class ClientService {
  async addClient(clientData) {
    const { 
      clientFirstName, 
      clientLastName, 
      clientEmail, 
      clientPhone, 
      clientAddress, 
      clientCity, 
      clientState, 
      clientZip, 
      businessName,
      preferences,
      careNotes,
      emergencyContact,
      medicalConditions,
      riskAssessment,
      organizationId,
      userEmail 
    } = clientData;

    try {
      // Verify user belongs to organization (if organizationId provided)
      if (organizationId && userEmail) {
        const user = await User.findOne({ 
          email: userEmail,
          organizationId: organizationId 
        });
        
        if (!user) {
          throw new Error('User not authorized for this organization');
        }
      }
      
      // Create client document with organization context
      const clientDoc = {
        clientFirstName,
        clientLastName,
        clientEmail,
        clientPhone,
        clientAddress,
        clientCity,
        clientState,
        clientZip,
        businessName,
        preferences: preferences || {}, // Default to empty object
        careNotes: careNotes || "", // Default to empty string
        emergencyContact: emergencyContact || {},
        medicalConditions: medicalConditions || [],
        riskAssessment: riskAssessment || {},
        organizationId: organizationId || null,
        isActive: true
      };
      
      const result = await Client.create(clientDoc);
      
      // Log audit trail
      if (userEmail) {
        await auditService.logAction({
          userEmail,
          action: 'CLIENT_CREATED',
          entityType: 'client',
          entityId: result._id,
          organizationId: organizationId || 'unknown',
          details: {
            clientId: result._id,
            clientName: `${clientFirstName} ${clientLastName}`,
            organizationId
          }
        });
      }
      
      return {
        success: true,
        clientId: result._id,
        message: "Client added successfully"
      };
      
    } catch (error) {
      throw error;
    }
  }

  async getClients(organizationId, userEmail) {
    try {
      // Verify user belongs to organization
      if (organizationId && userEmail) {
        const user = await User.findOne({ 
          email: userEmail,
          organizationId: organizationId 
        });
        
        if (!user) {
          throw new Error('User not authorized for this organization');
        }
      }
      
      const query = { isActive: true };
      if (organizationId) {
        query.organizationId = organizationId;
      }
      
      const clients = await Client.find(query);
      
      return {
        success: true,
        clients
      };
      
    } catch (error) {
      throw error;
    }
  }

  async getClientById(clientId, organizationId, userEmail) {
    try {
      // Verify user belongs to organization
      if (organizationId && userEmail) {
        const user = await User.findOne({ 
          email: userEmail,
          organizationId: organizationId 
        });
        
        if (!user) {
          throw new Error('User not authorized for this organization');
        }
      }
      
      const query = { 
        _id: clientId,
        isActive: true
      };
      
      if (organizationId) {
        query.organizationId = organizationId;
      }
      
      const clientDoc = await Client.findOne(query);
      
      if (!clientDoc) {
        throw new Error('Client not found');
      }
      
      return {
        success: true,
        client: clientDoc
      };
      
    } catch (error) {
      throw error;
    }
  }

  async updateClient(clientId, updateData, organizationId, userEmail) {
    try {
      // Verify user belongs to organization
      if (organizationId && userEmail) {
        const user = await User.findOne({ 
          email: userEmail,
          organizationId: organizationId 
        });
        
        if (!user) {
          throw new Error('User not authorized for this organization');
        }
      }
      
      const query = { 
        _id: clientId,
        isActive: true
      };
      
      if (organizationId) {
        query.organizationId = organizationId;
      }
      
      const updateDoc = {
        ...updateData,
        updatedAt: new Date()
      };
      
      const result = await Client.findOneAndUpdate(
        query,
        { $set: updateDoc },
        { new: true }
      );
      
      if (!result) {
        throw new Error('Client not found');
      }
      
      // Log audit trail
      if (userEmail) {
        await auditService.logAction({
          userEmail,
          action: 'CLIENT_UPDATED',
          entityType: 'client',
          entityId: clientId,
          organizationId: organizationId || 'unknown',
          details: {
            clientId,
            organizationId,
            updatedFields: Object.keys(updateData)
          }
        });
      }
      
      return {
        success: true,
        message: "Client updated successfully"
      };
      
    } catch (error) {
      throw error;
    }
  }

  async deleteClient(clientId, organizationId, userEmail) {
    try {
      // Verify user belongs to organization
      if (organizationId && userEmail) {
        const user = await User.findOne({ 
          email: userEmail,
          organizationId: organizationId 
        });
        
        if (!user) {
          throw new Error('User not authorized for this organization');
        }
      }
      
      const query = { 
        _id: clientId,
        isActive: true
      };
      
      if (organizationId) {
        query.organizationId = organizationId;
      }
      
      const result = await Client.findOneAndUpdate(
        query,
        { 
          $set: { 
            isActive: false,
            deletedAt: new Date(),
            updatedAt: new Date()
          }
        },
        { new: true }
      );
      
      if (!result) {
        throw new Error('Client not found');
      }
      
      // Log audit trail
      if (userEmail) {
        await auditService.logAction({
          userEmail,
          action: 'CLIENT_DELETED',
          entityType: 'client',
          entityId: clientId,
          organizationId: organizationId || 'unknown',
          details: {
            clientId,
            organizationId
          }
        });
      }
      
      return {
        success: true,
        message: "Client deleted successfully"
      };
      
    } catch (error) {
      throw error;
    }
  }

  async getClientPricing(clientId, organizationId, userEmail) {
    try {
      // Verify user belongs to organization
      if (organizationId && userEmail) {
        const user = await User.findOne({ 
          email: userEmail,
          organizationId: organizationId 
        });
        
        if (!user) {
          throw new Error('User not authorized for this organization');
        }
      }
      
      const query = { 
        clientId: clientId,
        isActive: true
      };
      
      if (organizationId) {
        query.organizationId = organizationId;
      }
      
      const pricing = await CustomPricing.find(query);
      
      return {
        success: true,
        pricing
      };
      
    } catch (error) {
      throw error;
    }
  }

  async updateClientPricing(clientId, pricingData, organizationId, userEmail) {
    try {
      // Verify user belongs to organization
      if (organizationId && userEmail) {
        const user = await User.findOne({ 
          email: userEmail,
          organizationId: organizationId 
        });
        
        if (!user) {
          throw new Error('User not authorized for this organization');
        }
      }
      
      // Process custom pricing
      const processedPricing = await processCustomPricing(pricingData, clientId, organizationId);
      
      // Log audit trail
      if (userEmail) {
        await auditService.logAction({
          userEmail,
          action: 'CLIENT_PRICING_UPDATED',
          entityType: 'pricing',
          entityId: clientId, // Using Client ID as the entity ID reference
          organizationId: organizationId || 'unknown',
          details: {
            clientId,
            organizationId,
            pricingCount: processedPricing.length
          }
        });
      }
      
      return {
        success: true,
        message: "Client pricing updated successfully",
        pricing: processedPricing
      };
      
    } catch (error) {
      throw error;
    }
  }

  async getMultipleClients(emails) {
    try {
      // Split emails if multiple are provided (comma-separated)
      const emailList = emails.split(',').map(email => email.trim());
      
      // Find clients with matching emails
      const clients = await Client.find({
        clientEmail: { $in: emailList },
        isActive: true
      });
      
      return clients;
    } catch (error) {
      throw error;
    }
  }

  async assignClientToUser(assignmentData) {
    try {
      const { 
        userEmail, 
        clientEmail, 
        dateList, 
        startTimeList, 
        endTimeList, 
        breakList, 
        ndisItem, 
        highIntensityList, 
        scheduleWithNdisItems 
      } = assignmentData;
      
      // Verify client exists
      const clientExists = await Client.findOne({ 
        clientEmail: clientEmail,
        isActive: true
      });

      if (!clientExists) {
        throw new Error('Client not found or inactive');
      }

      // Parse ndisItem if it's a string
      let parsedNdisItem = ndisItem;
      if (typeof ndisItem === 'string') {
        try {
          parsedNdisItem = JSON.parse(ndisItem);
        } catch {
          throw new Error('Invalid NDIS item format');
        }
      }

      // Extract customPricing from ndisItem if it exists
      if (parsedNdisItem && parsedNdisItem.customPricing) {
        delete parsedNdisItem.customPricing;
      }

      // Parse scheduleWithNdisItems if provided
      let parsedScheduleWithNdisItems = [];
      if (scheduleWithNdisItems && Array.isArray(scheduleWithNdisItems)) {
        for (let i = 0; i < scheduleWithNdisItems.length; i++) {
          let scheduleItem = scheduleWithNdisItems[i];
          if (typeof scheduleItem === 'string') {
            try {
              scheduleItem = JSON.parse(scheduleItem);
            } catch {
              throw new Error(`Invalid schedule item format at index ${i}`);
            }
          }
          parsedScheduleWithNdisItems.push(scheduleItem);
        }
      }

      // Update client with NDIS information
      let clientNdisItem = parsedNdisItem;
      if (parsedScheduleWithNdisItems.length > 0 && parsedScheduleWithNdisItems[0].ndisItem) {
        clientNdisItem = parsedScheduleWithNdisItems[0].ndisItem;
      }
      
      if (clientNdisItem) {
        await Client.updateOne(
          { clientEmail: clientEmail },
          { 
            $set: {
              ndisItem: clientNdisItem
            }
          }
        );
      }

      // Get user's organizationId if client doesn't have one
      let organizationId = clientExists.organizationId;
      if (!organizationId) {
        const user = await User.findOne({ 
          email: userEmail,
          isActive: true 
        });

        if (user && user.organizationId) {
          organizationId = user.organizationId;
          
          await Client.updateOne(
            { _id: clientExists._id },
            { 
              $set: {
                organizationId: organizationId,
                updatedAt: new Date()
              }
            }
          );
        }
      }
      
      // Create assignment data
      const scheduleData = dateList.map((date, i) => {
        let scheduleEntry = {
          date: date,
          startTime: startTimeList[i],
          endTime: endTimeList[i],
          break: breakList[i],
          highIntensity: highIntensityList[i],
        };
        
        if (parsedScheduleWithNdisItems.length > i && parsedScheduleWithNdisItems[i].ndisItem) {
          scheduleEntry.ndisItem = parsedScheduleWithNdisItems[i].ndisItem;
        } else if (parsedNdisItem) {
          scheduleEntry.ndisItem = parsedNdisItem;
        }
        
        return scheduleEntry;
      });
      
      const newAssignmentData = {
        userEmail: userEmail,
        clientEmail: clientEmail,
        clientId: clientExists._id,
        organizationId: organizationId,
        schedule: scheduleData,
        assignedNdisItemNumber: parsedNdisItem?.itemNumber || (parsedScheduleWithNdisItems.length > 0 ? parsedScheduleWithNdisItems[0].ndisItem?.itemNumber : null),
        isActive: true
      };

      // Check if assignment already exists
      const existingAssignment = await ClientAssignment.findOne({
        userEmail: userEmail,
        clientEmail: clientEmail,
        isActive: true
      });

      let finalAssignmentId;
      if (existingAssignment) {
        // Update existing assignment
        const existingSchedules = existingAssignment.schedule || [];
        const combinedSchedules = [...existingSchedules];
        
        scheduleData.forEach(newSchedule => {
          const conflictingScheduleIndex = combinedSchedules.findIndex(existingSchedule => 
            existingSchedule.date === newSchedule.date &&
            existingSchedule.startTime === newSchedule.startTime &&
            existingSchedule.endTime === newSchedule.endTime
          );
          
          if (conflictingScheduleIndex > -1) {
            combinedSchedules[conflictingScheduleIndex] = newSchedule;
          } else {
            combinedSchedules.push(newSchedule);
          }
        });

        const updateResult = await ClientAssignment.findOneAndUpdate(
          { _id: existingAssignment._id },
          { 
            $set: {
              schedule: combinedSchedules,
              updatedAt: new Date()
            }
          },
          { new: true }
        );
        
        if (!updateResult) {
          throw new Error('Assignment not found for update');
        }
        
        finalAssignmentId = existingAssignment._id;
      } else {
        // Create new assignment
        const insertResult = await ClientAssignment.create(newAssignmentData);
        
        finalAssignmentId = insertResult._id;
      }
      
      return {
        success: true,
        message: existingAssignment ? 'Assignment updated successfully' : 'Assignment created successfully',
        assignmentId: finalAssignmentId
      };
    } catch (error) {
      throw error;
    }
  }

  async getUserAssignments(userEmail) {
    try {
      const assignments = await ClientAssignment.aggregate([
        {
          $match: {
            userEmail: userEmail,
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
        }
      ]);
      
      return assignments;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new ClientService();
