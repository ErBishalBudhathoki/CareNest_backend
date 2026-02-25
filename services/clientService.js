const Client = require('../models/Client');
const User = require('../models/User');
const UserOrganization = require('../models/UserOrganization');
const ClientAssignment = require('../models/ClientAssignment');
const CustomPricing = require('../models/CustomPricing');
const auditService = require('./auditService');
const { processCustomPricing } = require('../utils/pricingHelpers');
const { admin } = require('../firebase-admin-config');

class ClientService {
  createServiceError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  buildNonDeletedClientQuery(baseQuery = {}) {
    return {
      ...baseQuery,
      $or: [
        { deletedAt: null },
        { deletedAt: { $exists: false } }
      ]
    };
  }

  _normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  _retentionDays() {
    const raw = Number.parseInt(
      process.env.CLIENT_SOFT_DELETE_RETENTION_DAYS || '90',
      10
    );
    if (Number.isNaN(raw) || raw <= 0) {
      return 90;
    }
    return raw;
  }

  _buildPurgeAfter(now = new Date()) {
    const days = this._retentionDays();
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  }

  async _deactivateClientAccess(clientEmail, organizationId) {
    const normalizedEmail = this._normalizeEmail(clientEmail);
    if (!normalizedEmail) return;

    const now = new Date();
    const mongoUser = await User.findOneAndUpdate(
      { email: normalizedEmail, role: 'client' },
      { $set: { isActive: false, updatedAt: now } },
      { new: true }
    );

    if (mongoUser) {
      const userOrgQuery = { userId: mongoUser._id.toString() };
      if (organizationId) {
        userOrgQuery.organizationId = String(organizationId);
      }
      await UserOrganization.updateMany(userOrgQuery, {
        $set: { isActive: false, updatedAt: now }
      });
    }

    try {
      const firebaseUser = await admin.auth().getUserByEmail(normalizedEmail);
      await admin.auth().updateUser(firebaseUser.uid, { disabled: true });
      await admin.auth().revokeRefreshTokens(firebaseUser.uid);
    } catch (firebaseError) {
      if (firebaseError.code !== 'auth/user-not-found') {
        console.error(
          '[ClientService] Failed to disable Firebase client account:',
          firebaseError.message
        );
      }
    }
  }

  async logAuditSafe(auditData, context) {
    try {
      await auditService.createAuditLog(auditData);
    } catch (auditError) {
      console.error(`[ClientService] Audit log failed during ${context}:`, auditError.message);
    }
  }

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
      const normalizedClientEmail = this._normalizeEmail(clientEmail);
      if (!normalizedClientEmail) {
        throw this.createServiceError('Valid client email is required', 400);
      }

      // CRITICAL: Require organizationId for multi-tenant isolation
      if (!organizationId) {
        throw this.createServiceError('Organization ID is required for client creation', 400);
      }

      // Verify user belongs to organization
      if (userEmail) {
        const userOrg = await UserOrganization.findOne({
          organizationId: organizationId,
          isActive: true
        }).populate('userId');
        
        if (!userOrg || userOrg.userId.email !== userEmail) {
          throw this.createServiceError('User not authorized for this organization', 403);
        }
      }
      
      // Check if client email already exists in this organization
      const existingClient = await Client.findOne(
        this.buildNonDeletedClientQuery({
          clientEmail: normalizedClientEmail,
          organizationId: organizationId
        })
      );
      
      if (existingClient) {
        throw this.createServiceError(
          'Client with this email already exists in your organization',
          409
        );
      }

      // If a matching client was soft-deleted, restore it instead of creating a duplicate.
      const softDeletedClient = await Client.findOne({
        clientEmail: normalizedClientEmail,
        organizationId: organizationId,
        deletedAt: { $ne: null }
      });
      if (softDeletedClient) {
        const restoredClient = await Client.findOneAndUpdate(
          { _id: softDeletedClient._id },
          {
            $set: {
              clientFirstName,
              clientLastName,
              clientEmail: normalizedClientEmail,
              clientPhone,
              clientAddress,
              clientCity,
              clientState,
              clientZip,
              businessName,
              preferences: preferences || {},
              careNotes: careNotes || '',
              emergencyContact: emergencyContact || {},
              medicalConditions: medicalConditions || [],
              riskAssessment: riskAssessment || {},
              isActive: true,
              isActivated: false,
              updatedAt: new Date()
            },
            $unset: {
              deletedAt: '',
              deletedBy: '',
              purgeAfter: ''
            }
          },
          { new: true }
        );

        if (restoredClient) {
          await this.logAuditSafe(
            {
              userEmail,
              action: auditService.AUDIT_ACTIONS.UPDATE,
              entityType: auditService.AUDIT_ENTITIES.CLIENT,
              entityId: restoredClient._id,
              organizationId: organizationId || 'unknown',
              metadata: {
                additionalInfo: {
                  clientId: restoredClient._id,
                  clientName: `${clientFirstName} ${clientLastName}`,
                  restoredFromSoftDelete: true
                }
              }
            },
            'restoreSoftDeletedClient'
          );

          return {
            success: true,
            clientId: restoredClient._id,
            message: 'Soft-deleted client restored successfully'
          };
        }
      }
      
      // Create client document with organization context
      const clientDoc = {
        clientFirstName,
        clientLastName,
        clientEmail: normalizedClientEmail,
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
        organizationId: organizationId, // Always required
        isActive: true,
        isActivated: false
      };
      
      const result = await Client.create(clientDoc);
      
      // Log audit trail
      if (userEmail) {
        await this.logAuditSafe({
          userEmail,
          action: auditService.AUDIT_ACTIONS.CREATE,
          entityType: auditService.AUDIT_ENTITIES.CLIENT,
          entityId: result._id,
          organizationId: organizationId || 'unknown',
          newValues: {
            clientFirstName,
            clientLastName,
            clientEmail,
            clientPhone
          },
          metadata: {
            additionalInfo: {
              clientId: result._id,
              clientName: `${clientFirstName} ${clientLastName}`,
              organizationId
            }
          }
        }, 'addClient');
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
      
      const query = this.buildNonDeletedClientQuery();
      if (organizationId) {
        query.organizationId = organizationId;
      }
      
      const clients = await Client.find(query).lean();

      if (!clients || clients.length === 0) {
        return {
          success: true,
          clients: []
        };
      }

      // Backfill activation status for legacy records by checking linked client users.
      const clientEmails = clients
        .map(c => String(c.clientEmail || '').trim().toLowerCase())
        .filter(Boolean);
      const activatedUsers = await User.find(
        {
          email: { $in: clientEmails },
          role: 'client',
          isActive: true
        },
        'email firebaseUid'
      ).lean();
      const activatedEmailSet = new Set(
        activatedUsers.map(u => String(u.email || '').trim().toLowerCase())
      );

      const normalizedClients = clients.map(client => ({
        ...client,
        isActivated:
          Boolean(client.isActivated) ||
          activatedEmailSet.has(
            String(client.clientEmail || '').trim().toLowerCase()
          )
      }));
      
      return {
        success: true,
        clients: normalizedClients
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
      
      const query = this.buildNonDeletedClientQuery({
        _id: clientId
      });
      
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
      
      const query = this.buildNonDeletedClientQuery({
        _id: clientId
      });
      
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
        await this.logAuditSafe({
          userEmail,
          action: auditService.AUDIT_ACTIONS.UPDATE,
          entityType: auditService.AUDIT_ENTITIES.CLIENT,
          entityId: clientId,
          organizationId: organizationId || 'unknown',
          newValues: updateData,
          metadata: {
            additionalInfo: {
              clientId,
              organizationId,
              updatedFields: Object.keys(updateData)
            }
          }
        }, 'updateClient');
      }
      
      return {
        success: true,
        message: "Client updated successfully"
      };
      
    } catch (error) {
      throw error;
    }
  }

  async deleteClient(clientId, organizationId, userEmail, forceDelete = false) {
    if (forceDelete) {
      return this.forceDeleteClient(clientId, organizationId, userEmail);
    }

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
      
      const query = this.buildNonDeletedClientQuery({
        _id: clientId
      });
      
      if (organizationId) {
        query.organizationId = organizationId;
      }

      const now = new Date();
      const purgeAfter = this._buildPurgeAfter(now);
      const retentionDays = this._retentionDays();
      
      const result = await Client.findOneAndUpdate(
        query,
        { 
          $set: { 
            isActive: false,
            isActivated: false,
            deletedAt: now,
            deletedBy: userEmail ? this._normalizeEmail(userEmail) : null,
            purgeAfter,
            updatedAt: now
          }
        },
        { new: true }
      );
      
      if (!result) {
        const existingQuery = { _id: clientId };
        if (organizationId) {
          existingQuery.organizationId = organizationId;
        }
        const existingClient = await Client.findOne(existingQuery).lean();
        if (existingClient && existingClient.deletedAt) {
          return {
            success: true,
            message: 'Client already deleted'
          };
        }
        throw new Error('Client not found');
      }

      await this._deactivateClientAccess(result.clientEmail, organizationId);
      
      // Log audit trail
      if (userEmail) {
        await this.logAuditSafe({
          userEmail,
          action: auditService.AUDIT_ACTIONS.DELETE,
          entityType: auditService.AUDIT_ENTITIES.CLIENT,
          entityId: clientId,
          organizationId: organizationId || 'unknown',
          metadata: {
            additionalInfo: {
              clientId,
              organizationId,
              retentionDays,
              purgeAfter: purgeAfter.toISOString()
            }
          }
        }, 'deleteClient');
      }
      
      return {
        success: true,
        message: `Client deleted successfully. Retained for ${retentionDays} days.`
      };
      
    } catch (error) {
      throw error;
    }
  }

  async forceDeleteClient(clientId, organizationId, userEmail) {
    try {
      if (organizationId && userEmail) {
        const user = await User.findOne({
          email: userEmail,
          organizationId: organizationId
        });

        if (!user) {
          throw new Error('User not authorized for this organization');
        }
      }

      const query = { _id: clientId };
      if (organizationId) {
        query.organizationId = organizationId;
      }

      const client = await Client.findOne(query);
      if (!client) {
        throw new Error('Client not found');
      }

      await this._deactivateClientAccess(client.clientEmail, organizationId);

      await Promise.all([
        ClientAssignment.deleteMany({
          $or: [{ clientId: client._id }, { clientEmail: client.clientEmail }],
          ...(organizationId ? { organizationId } : {})
        }),
        CustomPricing.deleteMany({
          ...(organizationId ? { organizationId } : {}),
          clientId: String(client._id)
        }),
        Client.deleteOne({ _id: client._id })
      ]);

      if (userEmail) {
        await this.logAuditSafe(
          {
            userEmail,
            action: auditService.AUDIT_ACTIONS.DELETE,
            entityType: auditService.AUDIT_ENTITIES.CLIENT,
            entityId: clientId,
            organizationId: organizationId || 'unknown',
            metadata: {
              additionalInfo: {
                clientId,
                organizationId,
                forceDeleted: true
              }
            }
          },
          'forceDeleteClient'
        );
      }

      return {
        success: true,
        message: 'Client permanently deleted successfully'
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
        await this.logAuditSafe({
          userEmail,
          action: auditService.AUDIT_ACTIONS.UPDATE,
          entityType: auditService.AUDIT_ENTITIES.PRICING,
          entityId: clientId, // Using Client ID as the entity ID reference
          organizationId: organizationId || 'unknown',
          metadata: {
            additionalInfo: {
              clientId,
              organizationId,
              pricingCount: processedPricing.length
            }
          }
        }, 'updateClientPricing');
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
        ...this.buildNonDeletedClientQuery(),
        clientEmail: { $in: emailList }
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
        ...this.buildNonDeletedClientQuery(),
        clientEmail: clientEmail
      });

      if (!clientExists) {
        throw new Error('Client not found or inactive');
      }
      if (clientExists.isActive === false) {
        throw new Error('Client is inactive');
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
