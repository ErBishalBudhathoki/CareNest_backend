const mongoose = require('mongoose');
const CustomPricing = require('../models/CustomPricing');
const PricingSettings = require('../models/PricingSettings');
const SupportItem = require('../models/SupportItem');
const Client = require('../models/Client');
const User = require('../models/User');
const auditService = require('./auditService');
const { priceValidationService } = require('./priceValidationService');

class PricingService {
  /**
   * Create custom pricing record
   */
  async createCustomPricing(pricingData, userEmail) {
    try {
      const {
        organizationId,
        supportItemNumber,
        supportItemName,
        pricingType,
        customPrice,
        multiplier,
        clientId,
        clientSpecific,
        ndisCompliant,
        exceedsNdisCap,
        effectiveDate,
        expiryDate
      } = pricingData;

      // Check for existing pricing
      const duplicateCheckQuery = {
        organizationId,
        supportItemNumber,
        clientSpecific: clientSpecific || false,
        isActive: true
      };

      if (clientSpecific && clientId) {
        duplicateCheckQuery.clientId = clientId;
      } else {
        duplicateCheckQuery.clientId = null;
      }

      const existingPricing = await CustomPricing.findOne(duplicateCheckQuery);
      if (existingPricing) {
        throw new Error('Custom pricing already exists for this support item');
      }

      // Create pricing document
      const pricingDoc = {
        organizationId,
        supportItemNumber,
        supportItemName,
        pricingType,
        customPrice: pricingType === 'fixed' ? customPrice : null,
        multiplier: pricingType === 'multiplier' ? multiplier : null,
        clientId: clientSpecific ? clientId : null,
        clientSpecific: clientSpecific || false,
        ndisCompliant: ndisCompliant !== undefined ? ndisCompliant : true,
        exceedsNdisCap: exceedsNdisCap || false,
        approvalStatus: exceedsNdisCap ? 'pending' : 'approved',
        effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        createdBy: userEmail,
        updatedBy: userEmail,
        isActive: true,
        version: 1,
        auditTrail: [{
          action: 'created',
          performedBy: userEmail,
          timestamp: new Date(),
          changes: 'Initial creation',
          reason: 'Custom pricing created'
        }]
      };

      const result = await CustomPricing.create(pricingDoc);
      
      // Create audit log
      await auditService.createAuditLog({
        entityType: 'pricing',
        entityId: result._id.toString(),
        action: 'CREATE',
        userEmail: userEmail,
        organizationId,
        newValues: result.toObject(),
        reason: 'Custom pricing created',
        metadata: {
          supportItemNumber,
          supportItemName,
          pricingType,
          price: pricingType === 'fixed' ? customPrice : multiplier,
          clientSpecific: clientSpecific || false
        }
      });

      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get organization pricing with pagination and filtering
   */
  async getOrganizationPricing(organizationId, options = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        search,
        clientSpecific,
        approvalStatus,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = options;

      const skip = (page - 1) * limit;
      const query = { organizationId, isActive: true };

      // Add filters
      if (search) {
        query.$or = [
          { supportItemNumber: { $regex: search, $options: 'i' } },
          { supportItemName: { $regex: search, $options: 'i' } }
        ];
      }

      if (clientSpecific !== undefined) {
        query.clientSpecific = clientSpecific;
      }

      if (approvalStatus) {
        query.approvalStatus = approvalStatus;
      }

      const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

      const [pricing, total] = await Promise.all([
        CustomPricing.find(query)
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit)),
        CustomPricing.countDocuments(query)
      ]);

      return {
        pricing,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get pricing by ID
   */
  async getPricingById(pricingId) {
    try {
      const pricing = await CustomPricing.findOne({
        _id: pricingId,
        isActive: true
      });

      return pricing;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update custom pricing
   */
  async updateCustomPricing(pricingId, updateData, userEmail) {
    try {
      const existingPricing = await CustomPricing.findOne({
        _id: pricingId,
        isActive: true
      });

      if (!existingPricing) {
        throw new Error('Pricing record not found');
      }

      const {
        supportItemName,
        pricingType,
        customPrice,
        multiplier,
        clientId,
        clientSpecific,
        ndisCompliant,
        exceedsNdisCap,
        effectiveDate,
        expiryDate
      } = updateData;

      // Build update object
      const updateObj = {
        updatedBy: userEmail,
        updatedAt: new Date(),
        version: (existingPricing.version || 1) + 1
      };

      // Track changes for audit trail
      const changes = [];
      const auditTrailEntry = {
        action: 'updated',
        performedBy: userEmail,
        timestamp: new Date(),
        reason: 'Pricing update'
      };

      // Update fields and track changes
      if (supportItemName !== undefined && supportItemName !== existingPricing.supportItemName) {
        updateObj.supportItemName = supportItemName;
        changes.push(`supportItemName: ${existingPricing.supportItemName} → ${supportItemName}`);
      }

      if (pricingType !== undefined && pricingType !== existingPricing.pricingType) {
        updateObj.pricingType = pricingType;
        updateObj.customPrice = pricingType === 'fixed' ? customPrice : null;
        updateObj.multiplier = pricingType === 'multiplier' ? multiplier : null;
        changes.push(`pricingType: ${existingPricing.pricingType} → ${pricingType}`);
      } else {
        if (customPrice !== undefined && customPrice !== existingPricing.customPrice) {
          updateObj.customPrice = customPrice;
          changes.push(`customPrice: ${existingPricing.customPrice} → ${customPrice}`);
        }
        if (multiplier !== undefined && multiplier !== existingPricing.multiplier) {
          updateObj.multiplier = multiplier;
          changes.push(`multiplier: ${existingPricing.multiplier} → ${multiplier}`);
        }
      }

      if (clientId !== undefined && clientId !== existingPricing.clientId) {
        updateObj.clientId = clientId;
        changes.push(`clientId: ${existingPricing.clientId} → ${clientId}`);
      }

      if (clientSpecific !== undefined && clientSpecific !== existingPricing.clientSpecific) {
        updateObj.clientSpecific = clientSpecific;
        changes.push(`clientSpecific: ${existingPricing.clientSpecific} → ${clientSpecific}`);
      }

      if (ndisCompliant !== undefined && ndisCompliant !== existingPricing.ndisCompliant) {
        updateObj.ndisCompliant = ndisCompliant;
        changes.push(`ndisCompliant: ${existingPricing.ndisCompliant} → ${ndisCompliant}`);
      }

      if (exceedsNdisCap !== undefined && exceedsNdisCap !== existingPricing.exceedsNdisCap) {
        updateObj.exceedsNdisCap = exceedsNdisCap;
        changes.push(`exceedsNdisCap: ${existingPricing.exceedsNdisCap} → ${exceedsNdisCap}`);
      }

      if (effectiveDate !== undefined) {
        const newEffectiveDate = new Date(effectiveDate);
        if (newEffectiveDate.getTime() !== new Date(existingPricing.effectiveDate).getTime()) {
          updateObj.effectiveDate = newEffectiveDate;
          changes.push(`effectiveDate: ${existingPricing.effectiveDate} → ${newEffectiveDate}`);
        }
      }

      if (expiryDate !== undefined) {
        const newExpiryDate = expiryDate ? new Date(expiryDate) : null;
        const existingExpiryDate = existingPricing.expiryDate ? new Date(existingPricing.expiryDate) : null;
        if ((newExpiryDate?.getTime() || null) !== (existingExpiryDate?.getTime() || null)) {
          updateObj.expiryDate = newExpiryDate;
          changes.push(`expiryDate: ${existingExpiryDate} → ${newExpiryDate}`);
        }
      }

      if (changes.length > 0) {
        auditTrailEntry.changes = changes.join(', ');
        updateObj.$push = { auditTrail: auditTrailEntry };
      }

      const result = await CustomPricing.findOneAndUpdate(
        { _id: pricingId },
        { $set: updateObj, ...(updateObj.$push && { $push: updateObj.$push }) },
        { new: true }
      );

      if (!result) {
        throw new Error('No changes were made to the pricing record');
      }

      // Create audit log
      await auditService.createAuditLog({
        entityType: 'pricing',
        entityId: pricingId,
        action: 'UPDATE',
        userEmail: userEmail,
        organizationId: existingPricing.organizationId,
        oldValues: existingPricing.toObject(),
        newValues: result.toObject(),
        reason: 'Pricing update',
        metadata: {
          changes: changes.join(', '),
          supportItemNumber: existingPricing.supportItemNumber
        }
      });

      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete custom pricing (soft delete)
   */
  async deleteCustomPricing(pricingId, userEmail) {
    try {
      const existingPricing = await CustomPricing.findOne({
        _id: pricingId,
        isActive: true
      });

      if (!existingPricing) {
        throw new Error('Pricing record not found');
      }

      const result = await CustomPricing.updateOne(
        { _id: pricingId },
        {
          $set: {
            isActive: false,
            deletedBy: userEmail,
            deletedAt: new Date(),
            updatedBy: userEmail,
            updatedAt: new Date()
          },
          $push: {
            auditTrail: {
              action: 'deleted',
              performedBy: userEmail,
              timestamp: new Date(),
              changes: 'Soft delete - isActive set to false',
              reason: 'Pricing deletion'
            }
          }
        }
      );

      // Create audit log
      await auditService.createAuditLog({
        entityType: 'pricing',
        entityId: pricingId,
        action: 'DELETE',
        userEmail: userEmail,
        organizationId: existingPricing.organizationId,
        details: {
          supportItemNumber: existingPricing.supportItemNumber,
          supportItemName: existingPricing.supportItemName
        }
      });

      return result.modifiedCount > 0;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update pricing approval status
   */
  async updatePricingApproval(pricingId, approvalStatus, userEmail) {
    try {
      const existingPricing = await CustomPricing.findOne({
        _id: pricingId,
        isActive: true
      });

      if (!existingPricing) {
        throw new Error('Pricing record not found');
      }

      const result = await CustomPricing.findOneAndUpdate(
        { _id: pricingId },
        {
          $set: {
            approvalStatus,
            updatedBy: userEmail,
            updatedAt: new Date()
          },
          $push: {
            auditTrail: {
              action: 'approval_updated',
              performedBy: userEmail,
              timestamp: new Date(),
              changes: `Approval status changed from ${existingPricing.approvalStatus} to ${approvalStatus}`,
              reason: 'Approval status update'
            }
          }
        },
        { new: true }
      );

      // Create audit log
      await auditService.createAuditLog({
        entityType: 'pricing',
        entityId: pricingId,
        action: 'APPROVE', // Using APPROVE for both approve/reject/pending for simplicity or could be dynamic
        userEmail: userEmail,
        organizationId: existingPricing.organizationId,
        details: {
          approvalStatus,
          supportItemNumber: existingPricing.supportItemNumber
        }
      });

      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get pricing lookup for a single item
   */
  async getPricingLookup(organizationId, supportItemNumber, clientId = null) {
    try {
      const currentDate = new Date();
      let clientIdForQuery = null;
      let stateUsed = 'NSW'; // default fallback
      let stateSource = 'fallback';
      let providerTypeUsed = 'standard';

      // Pre-fetch support item for caps and metadata
      const supportItemDoc = await SupportItem.findOne({
        supportItemNumber
      });

      // Convert clientId to string for consistent querying
      if (clientId) {
        clientIdForQuery = clientId.toString();

        // Resolve client state for accurate cap selection
        try {
          const clientDoc = await Client.findOne(
            { _id: clientIdForQuery },
            { clientState: 1 }
          );
          if (clientDoc && clientDoc.clientState) {
            stateUsed = String(clientDoc.clientState).toUpperCase();
            stateSource = 'client';
          }
        } catch {
          // Keep fallback on errors; include no sensitive error surfaces
          stateUsed = 'NSW';
          stateSource = 'fallback';
        }
      }

      // Priority 1: Client-specific pricing
      if (clientIdForQuery) {
        const clientSpecificPricing = await CustomPricing.findOne({
          organizationId,
          supportItemNumber,
          clientId: clientIdForQuery,
          clientSpecific: true,
          isActive: true,
          approvalStatus: 'approved',
          effectiveDate: { $lte: currentDate },
          $or: [
            { expiryDate: null },
            { expiryDate: { $gte: currentDate } }
          ]
        }).sort({ effectiveDate: -1 });

        if (clientSpecificPricing) {
          // Base price-only policy: do not clamp custom price to cap
          const originalPrice = clientSpecificPricing.customPrice;

          // Validate against NDIS cap for metadata only
          const validation = await priceValidationService.validatePrice(
            supportItemNumber,
            originalPrice,
            stateUsed,
            providerTypeUsed
          );

          return {
            ...clientSpecificPricing.toObject(),
            price: originalPrice,
            source: 'client_specific',
            ndisCompliant: validation.isValid,
            exceedsNdisCap: !validation.isValid && validation.status === 'exceeds_cap',
            priceCap: validation.priceCap,
            priceCaps: supportItemDoc?.priceCaps,
            supportItemName: supportItemDoc?.supportItemName,
            validationDetails: validation,
            metadata: {
              stateUsed,
              stateSource,
              providerTypeUsed
            }
          };
        }
      }

      // Priority 2: Organization-level pricing
      const organizationPricing = await CustomPricing.findOne({
        organizationId,
        supportItemNumber,
        clientSpecific: false,
        isActive: true,
        approvalStatus: 'approved',
        effectiveDate: { $lte: currentDate },
        $or: [
          { expiryDate: null },
          { expiryDate: { $gte: currentDate } }
        ]
      }).sort({ effectiveDate: -1 });

      if (organizationPricing) {
        // Base price-only policy: do not clamp custom price to cap
        const originalPrice = organizationPricing.customPrice;

        // Validate against NDIS cap for metadata only
        const validation = await priceValidationService.validatePrice(
          supportItemNumber,
          originalPrice,
          stateUsed,
          providerTypeUsed
        );

        return {
          ...organizationPricing.toObject(),
          price: originalPrice,
          source: 'organization',
          ndisCompliant: validation.isValid,
          exceedsNdisCap: !validation.isValid && validation.status === 'exceeds_cap',
          priceCap: validation.priceCap,
          priceCaps: supportItemDoc?.priceCaps,
          supportItemName: supportItemDoc?.supportItemName,
          validationDetails: validation,
          metadata: {
            stateUsed,
            stateSource,
            providerTypeUsed
          }
        };
      }

      // Priority 3: NDIS default pricing
      if (supportItemDoc) {
        // Base price-only: Never return cap as price; surface caps for metadata only
        let priceCap = priceValidationService.getPriceCap(
          supportItemDoc,
          stateUsed,
          providerTypeUsed
        );

        if (priceCap !== null) {
          return {
            source: 'ndis_default',
            supportItemNumber,
            supportItemName: supportItemDoc.supportItemName,
            price: null,
            standardPrice: null,
            pricingType: 'cap_rate',
            ndisCompliant: true,
            exceedsNdisCap: false,
            priceCap,
            priceCaps: supportItemDoc.priceCaps,
            metadata: {
              stateUsed,
              stateSource,
              providerTypeUsed
            }
          };
        }

        // No cap found – do not inject a synthetic $30 fallback
        return {
          source: 'ndis_default',
          supportItemNumber,
          supportItemName: supportItemDoc.supportItemName,
          price: null,
          standardPrice: null,
          pricingType: 'unknown',
          ndisCompliant: true,
          exceedsNdisCap: false,
          priceCap: null,
          priceCaps: supportItemDoc.priceCaps,
          metadata: {
            stateUsed,
            stateSource,
            providerTypeUsed,
            baselinePolicy: 'No cap found; reasonable price agreement applies; notional unit price $1.00'
          }
        };
      }

      return null;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get bulk pricing lookup for multiple items
   */
  async getBulkPricingLookup(organizationId, supportItemNumbers, clientId = null) {
    try {
      let clientIdForQuery = null;
      let stateUsed = 'NSW';
      let stateSource = 'fallback';
      let providerTypeUsed = 'standard';
      if (clientId) {
        clientIdForQuery = clientId.toString();

        // Resolve state from client when possible
        try {
          const clientDoc = await Client.findOne(
            { _id: clientIdForQuery },
            { clientState: 1 }
          );
          if (clientDoc && clientDoc.clientState) {
            stateUsed = String(clientDoc.clientState).toUpperCase();
            stateSource = 'client';
          }
        } catch {
          stateUsed = 'NSW';
          stateSource = 'fallback';
        }
      }

      const currentDate = new Date();
      const results = {};

      // Build aggregation pipeline for efficient bulk lookup
      const customPricingPipeline = [
        {
          $match: {
            organizationId,
            supportItemNumber: { $in: supportItemNumbers },
            isActive: true,
            approvalStatus: 'approved',
            effectiveDate: { $lte: currentDate },
            $or: [
              { expiryDate: null },
              { expiryDate: { $gte: currentDate } }
            ]
          }
        },
        {
          $addFields: {
            priority: {
              $cond: {
                if: { $and: [{ $eq: ['$clientSpecific', true] }, { $eq: ['$clientId', clientIdForQuery] }] },
                then: 1,
                else: {
                  $cond: {
                    if: { $eq: ['$clientSpecific', false] },
                    then: 2,
                    else: 3
                  }
                }
              }
            }
          }
        },
        { $sort: { supportItemNumber: 1, priority: 1, effectiveDate: -1 } },
        {
          $group: {
            _id: '$supportItemNumber',
            pricing: { $first: '$$ROOT' }
          }
        }
      ];

      const customPricingResults = await CustomPricing.aggregate(customPricingPipeline);

      // Map custom pricing results
      const customPricingMap = {};
      customPricingResults.forEach(result => {
        const pricing = result.pricing;
        customPricingMap[result._id] = {
          ...pricing,
          price: pricing.customPrice,
          source: pricing.clientSpecific ? 'client_specific' : 'organization'
        };
      });

      // Find items without custom pricing
      const itemsWithoutCustomPricing = supportItemNumbers.filter(
        itemNumber => !customPricingMap[itemNumber]
      );

      // Get NDIS default pricing for items without custom pricing
      let ndisDefaultPricing = {};
      let priceCapsData = {};

      const allNdisItems = await SupportItem.find({ supportItemNumber: { $in: supportItemNumbers } });

      allNdisItems.forEach(item => {
        priceCapsData[item.supportItemNumber] = {
          priceCaps: item.priceCaps,
          supportItemName: item.supportItemName
        };

        if (itemsWithoutCustomPricing.includes(item.supportItemNumber)) {
          const priceCap = priceValidationService.getPriceCap(
            item,
            stateUsed,
            providerTypeUsed
          );

          if (priceCap !== null) {
            ndisDefaultPricing[item.supportItemNumber] = {
              source: 'ndis_default',
              supportItemNumber: item.supportItemNumber,
              supportItemName: item.supportItemName,
              price: priceCap,
              standardPrice: priceCap,
              pricingType: 'cap_rate',
              ndisCompliant: true,
              exceedsNdisCap: false,
              priceCap,
              priceCaps: item.priceCaps,
              metadata: {
                stateUsed,
                stateSource,
                providerTypeUsed
              }
            };
          } else {
            ndisDefaultPricing[item.supportItemNumber] = {
              source: 'ndis_default',
              supportItemNumber: item.supportItemNumber,
              supportItemName: item.supportItemName,
              price: null,
              standardPrice: null,
              pricingType: 'unknown',
              ndisCompliant: true,
              exceedsNdisCap: false,
              priceCap: null,
              priceCaps: item.priceCaps,
              metadata: {
                stateUsed,
                stateSource,
                providerTypeUsed,
                baselinePolicy: 'No cap found; reasonable price agreement applies; notional unit price $1.00'
              }
            };
          }
        }
      });

      // Combine results
      for (const itemNumber of supportItemNumbers) {
        if (customPricingMap[itemNumber]) {
          const cp = customPricingMap[itemNumber];
          const priceCapsObj = priceCapsData[itemNumber]?.priceCaps;
          const supportName = priceCapsData[itemNumber]?.supportItemName;

          const originalPrice = cp.price;
          // Validate against NDIS cap for metadata only
          const validation = await priceValidationService.validatePrice(
            itemNumber,
            originalPrice,
            stateUsed,
            providerTypeUsed
          );

          results[itemNumber] = {
            ...cp,
            price: originalPrice,
            customPrice: cp.price,
            priceCaps: priceCapsObj,
            supportItemName: supportName,
            ndisCompliant: validation.isValid,
            exceedsNdisCap: !validation.isValid && validation.status === 'exceeds_cap',
            priceCap: validation.priceCap,
            validationDetails: validation,
            metadata: {
              stateUsed,
              stateSource,
              providerTypeUsed
            }
          };
        } else if (ndisDefaultPricing[itemNumber]) {
          // Ensure base-only behavior in default pricing
          const def = ndisDefaultPricing[itemNumber];
          results[itemNumber] = {
            ...def,
            price: null,
            standardPrice: null
          };
        } else {
          results[itemNumber] = {
            error: 'No pricing found for this support item',
            supportItemNumber: itemNumber,
            priceCaps: priceCapsData[itemNumber]?.priceCaps,
            supportItemName: priceCapsData[itemNumber]?.supportItemName,
            metadata: {
              stateUsed,
              stateSource,
              providerTypeUsed
            }
          };
        }
      }

      return {
        data: results,
        metadata: {
          totalItems: supportItemNumbers.length,
          customPricingItems: Object.keys(customPricingMap).length,
          ndisDefaultItems: Object.keys(ndisDefaultPricing).length,
          notFoundItems: supportItemNumbers.length - Object.keys(customPricingMap).length - Object.keys(ndisDefaultPricing).length
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Bulk import pricing records
   */
  async bulkImportPricing(organizationId, pricingRecords, userEmail, importNotes = null) {
    try {
      const results = {
        successful: 0,
        failed: 0,
        errors: []
      };

      const bulkOps = [];
      const updateOps = [];

      for (let i = 0; i < pricingRecords.length; i++) {
        const record = pricingRecords[i];

        try {
          // Validate required fields
          if (!record.supportItemNumber || !record.supportItemName || !record.pricingType) {
            results.failed++;
            results.errors.push({
              row: i + 1,
              error: 'Missing required fields: supportItemNumber, supportItemName, pricingType'
            });
            continue;
          }

          const isClientSpecific = record.clientSpecific || false;
          const targetClientId = isClientSpecific ? record.clientId : null;

          // Check for existing pricing
          const duplicateCheckQuery = {
            organizationId,
            supportItemNumber: record.supportItemNumber,
            clientSpecific: isClientSpecific,
            isActive: true
          };

          if (isClientSpecific) {
            duplicateCheckQuery.clientId = targetClientId;
          } else {
            duplicateCheckQuery.clientId = null;
          }

          const existingCustomPricing = await CustomPricing.findOne(duplicateCheckQuery);

          if (existingCustomPricing) {
            const newPrice = record.pricingType === 'fixed' ? record.customPrice : record.multiplier;
            const existingPrice = existingCustomPricing.pricingType === 'fixed' ? existingCustomPricing.customPrice : existingCustomPricing.multiplier;

            if (newPrice !== existingPrice) {
              updateOps.push({
                updateOne: {
                  filter: { _id: existingCustomPricing._id },
                  update: {
                    $set: {
                      pricingType: record.pricingType,
                      customPrice: record.pricingType === 'fixed' ? record.customPrice : null,
                      multiplier: record.pricingType === 'multiplier' ? record.multiplier : null,
                      updatedBy: userEmail,
                      updatedAt: new Date(),
                      version: (existingCustomPricing.version || 1) + 1
                    },
                    $push: {
                      auditTrail: {
                        action: 'bulk_updated',
                        performedBy: userEmail,
                        timestamp: new Date(),
                        changes: `Price updated from ${existingPrice} to ${newPrice} via bulk import`,
                        reason: importNotes || 'Bulk import operation'
                      }
                    }
                  }
                }
              });
            }
            results.successful++;
            continue;
          }

          // Create new pricing record
          const pricingDoc = {
            organizationId,
            supportItemNumber: record.supportItemNumber,
            supportItemName: record.supportItemName,
            pricingType: record.pricingType,
            customPrice: record.pricingType === 'fixed' ? record.customPrice : null,
            multiplier: record.pricingType === 'multiplier' ? record.multiplier : null,
            clientId: targetClientId,
            clientSpecific: isClientSpecific,
            ndisCompliant: record.ndisCompliant !== undefined ? record.ndisCompliant : true,
            exceedsNdisCap: record.exceedsNdisCap || false,
            approvalStatus: record.exceedsNdisCap ? 'pending' : 'approved',
            effectiveDate: record.effectiveDate ? new Date(record.effectiveDate) : new Date(),
            expiryDate: record.expiryDate ? new Date(record.expiryDate) : null,
            createdBy: userEmail,
            updatedBy: userEmail,
            isActive: true,
            version: 1,
            auditTrail: [{
              action: 'bulk_imported',
              performedBy: userEmail,
              timestamp: new Date(),
              changes: 'Bulk import',
              reason: importNotes || 'Bulk import operation'
            }]
          };

          bulkOps.push({
            insertOne: {
              document: pricingDoc
            }
          });

          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            row: i + 1,
            error: error.message
          });
        }
      }

      // Execute bulk operations
      if (bulkOps.length > 0) {
        await CustomPricing.bulkWrite(bulkOps, { ordered: false });
      }

      if (updateOps.length > 0) {
        await CustomPricing.bulkWrite(updateOps, { ordered: false });
      }

      return results;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get standard price for a single support item (base price-only)
   * Does NOT consider custom pricing; returns null for price and surfaces caps for validation metadata.
   */
  async getStandardPrice(supportItemNumber, clientId = null) {
    try {
      let stateUsed = 'NSW';
      let stateSource = 'fallback';
      let providerTypeUsed = 'standard';

      // Resolve state from client when possible
      if (clientId) {
        try {
          const clientIdStr = clientId.toString();
          if (clientIdStr) {
            const clientDoc = await Client.findOne(
              { _id: clientIdStr },
              { clientState: 1 }
            );
            if (clientDoc && clientDoc.clientState) {
              stateUsed = String(clientDoc.clientState).toUpperCase();
              stateSource = 'client';
            }
          }
        } catch {
          stateUsed = 'NSW';
          stateSource = 'fallback';
        }
      }

      const supportItemDoc = await SupportItem.findOne({ supportItemNumber });
      if (!supportItemDoc) {
        return {
          supportItemNumber,
          supportItemName: null,
          price: null,
          priceCap: null,
          metadata: { stateUsed, stateSource, providerTypeUsed }
        };
      }

      const priceCap = priceValidationService.getPriceCap(
        supportItemDoc,
        stateUsed,
        providerTypeUsed
      );

      // Base price-only: never return cap as price
      return {
        supportItemNumber,
        supportItemName: supportItemDoc.supportItemName,
        price: null,
        priceCap: priceCap,
        priceCaps: supportItemDoc.priceCaps,
        metadata: { stateUsed, stateSource, providerTypeUsed }
      };
    } catch (error) {
      throw error;
    }
  }
  /**
   * Validate user authorization for organization
   */
  async validateUserAuthorization(userEmail, organizationId) {
    try {
      const user = await User.findOne({
        email: userEmail,
        organizationId
      });

      return !!user;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new PricingService();
