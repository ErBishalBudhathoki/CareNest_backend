const PricingSettings = require('../models/PricingSettings');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const { createAuditLog, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('../services/auditService');

class SettingsController {
  /**
   * Get General Pricing Settings
   * GET /api/settings/general
   */
  getGeneralSettings = catchAsync(async (req, res) => {
    const organizationId = req.user.organizationId || req.query.organizationId;

    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    const settings = await PricingSettings.findOne({ organizationId, isActive: true });

    if (!settings) {
        // Return defaults if not found, or 404? 
        // Typically settings endpoints return defaults if not set.
        // But for now, let's return null data or 404. 
        // Based on previous implementation, it expects upsert on update, so likely 404 or empty is fine.
        return res.status(200).json({ success: true, data: {} });
    }

    res.status(200).json({ success: true, data: settings });
  });

  /**
   * Update General Pricing Settings
   * PUT /api/settings/general
   */
  updateGeneralSettings = catchAsync(async (req, res) => {
    const user = req.user;
    const organizationId = user.organizationId || req.body.organizationId;

    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'Organization ID is required' });
    }

    // Input validation is handled by express-validator in routes
    const updateData = req.body;
    
    // Whitelist allowed fields to prevent pollution
    const allowedFields = [
        'autoUpdatePricing', 'enablePriceValidation', 'requireApprovalForChanges',
        'enableBulkOperations', 'enablePriceHistory', 'enableNotifications',
        'defaultCurrency', 'pricingModel', 'roundingMethod', 'taxCalculation',
        'fallbackBaseRate', 'defaultMarkup', 'maxPriceVariation',
        'priceHistoryRetention', 'bulkOperationLimit'
    ];

    const sanitizedData = {};
    allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
            sanitizedData[field] = updateData[field];
        }
    });

    sanitizedData.updatedBy = user.email;
    sanitizedData.updatedAt = new Date();

    // Upsert
    const existing = await PricingSettings.findOne({ organizationId, isActive: true });
    let resultDoc;

    if (existing) {
        resultDoc = await PricingSettings.findByIdAndUpdate(
            existing._id,
            {
                $set: {
                    ...sanitizedData,
                    version: (existing.version || 1) + 1
                },
                $push: {
                    auditTrail: {
                        action: 'updated',
                        performedBy: user.email,
                        timestamp: new Date(),
                        changes: 'General settings updated',
                        reason: 'API update'
                    }
                }
            },
            { new: true, runValidators: true }
        );
    } else {
        resultDoc = await PricingSettings.create({
            organizationId,
            ...sanitizedData,
            createdBy: user.email,
            auditTrail: [{
                action: 'created',
                performedBy: user.email,
                timestamp: new Date(),
                changes: 'General settings created',
                reason: 'Initial creation'
            }]
        });
    }

    // Audit Log (Async)
    try {
        await createAuditLog({
            action: AUDIT_ACTIONS.UPDATE,
            entityType: AUDIT_ENTITIES.PRICING,
            entityId: resultDoc.id,
            userEmail: user.email,
            organizationId,
            newValues: sanitizedData,
            reason: 'Updated general settings',
            metadata: { setting: 'generalSettings' }
        });
    } catch (e) {
        logger.error('Audit log failed', e);
    }

    res.status(200).json({
        success: true,
        message: 'General settings updated',
        data: resultDoc
    });
  });
}

module.exports = new SettingsController();
