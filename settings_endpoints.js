/**
 * General Settings API Endpoints
 * Provides atomic update of organization-wide general pricing settings
 *
 * Endpoints:
 * - PUT  /api/settings/general           (preferred)
 * - POST /api/settings/general           (fallback)
 * - PUT  /api/v1/settings/general        (versioned)
 * - POST /api/v1/settings/general        (versioned fallback)
 *
 * Security: Requires JWT auth. Uses req.user (email, organizationId)
 */

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const InputValidator = require('./utils/inputValidator');
const { createAuditLog, AUDIT_ACTIONS, AUDIT_ENTITIES } = require('./services/auditService');

const uri = process.env.MONGODB_URI;

/**
 * Validate and sanitize general settings payload.
 * Returns { isValid, errors, sanitized }
 */
function validateGeneralSettingsPayload(payload) {
  const errors = {};
  const sanitized = {};

  // Helper: boolean validation
  const boolFields = [
    'autoUpdatePricing',
    'enablePriceValidation',
    'requireApprovalForChanges',
    'enableBulkOperations',
    'enablePriceHistory',
    'enableNotifications',
  ];
  for (const field of boolFields) {
    const value = payload[field];
    if (typeof value !== 'boolean') {
      errors[field] = `${field} must be a boolean`;
    } else {
      sanitized[field] = value;
    }
  }

  // String settings
  const defaultCurrency = (payload.defaultCurrency || '').toString().trim().toUpperCase();
  if (!defaultCurrency || defaultCurrency.length !== 3 || !/^[A-Z]{3}$/.test(defaultCurrency)) {
    errors.defaultCurrency = 'defaultCurrency must be a 3-letter currency code (e.g., AUD)';
  } else {
    sanitized.defaultCurrency = defaultCurrency;
  }

  const pricingModel = (payload.pricingModel || '').toString().trim();
  if (!pricingModel || pricingModel.length > 100) {
    errors.pricingModel = 'pricingModel is required and must be <= 100 characters';
  } else {
    sanitized.pricingModel = InputValidator.sanitizeString(pricingModel);
  }

  const roundingMethod = (payload.roundingMethod || '').toString().trim();
  if (!roundingMethod || roundingMethod.length > 100) {
    errors.roundingMethod = 'roundingMethod is required and must be <= 100 characters';
  } else {
    sanitized.roundingMethod = InputValidator.sanitizeString(roundingMethod);
  }

  const taxCalculation = (payload.taxCalculation || '').toString().trim();
  const allowedTax = ['GST Inclusive', 'GST Exclusive'];
  if (!taxCalculation || !allowedTax.includes(taxCalculation)) {
    errors.taxCalculation = `taxCalculation must be one of: ${allowedTax.join(', ')}`;
  } else {
    sanitized.taxCalculation = taxCalculation;
  }

  // Numeric settings
  function validateNumber(field, min, max, allowFloat = true) {
    const value = Number(payload[field]);
    if (!Number.isFinite(value)) {
      errors[field] = `${field} must be a number`;
      return;
    }
    if (!allowFloat && !Number.isInteger(value)) {
      errors[field] = `${field} must be an integer`;
      return;
    }
    if (value < min || value > max) {
      errors[field] = `${field} must be between ${min} and ${max}`;
      return;
    }
    sanitized[field] = allowFloat ? Number(value.toFixed(2)) : value;
  }

  validateNumber('defaultMarkup', 0, 100, true);
  validateNumber('maxPriceVariation', 0, 100, true);
  validateNumber('priceHistoryRetention', 1, 3650, false);
  validateNumber('bulkOperationLimit', 1, 10000, false);

  return { isValid: Object.keys(errors).length === 0, errors, sanitized };
}

/**
 * Core handler: update general settings atomically for an organization.
 * Uses req.user.organizationId and req.user.email from auth middleware.
 */
async function updateGeneralSettings(req, res) {
  let client;
  try {
    // Enforce request size limits for performance
    const sizeCheck = InputValidator.validateRequestSize(req.body, 1024 * 16); // 16KB
    if (!sizeCheck.isValid) {
      return res.status(413).json({ statusCode: 413, message: 'Payload too large' });
    }

    // Security: must be authenticated
    const user = req.user;
    if (!user || !user.email) {
      return res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
    }

    // Resolve organization context
    const organizationId = user.organizationId || req.body.organizationId;
    if (!organizationId || typeof organizationId !== 'string' || organizationId.trim().length < 2) {
      return res.status(400).json({ statusCode: 400, message: 'organizationId is required' });
    }

    const validation = validateGeneralSettingsPayload(req.body);
    if (!validation.isValid) {
      return res.status(400).json({ statusCode: 400, errors: validation.errors, message: 'Invalid input' });
    }

    client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });
    await client.connect();
    const db = client.db('Invoice');

    // Verify user belongs to organization
    const userDoc = await db.collection('login').findOne({ email: user.email, organizationId });
    if (!userDoc) {
      return res.status(403).json({ statusCode: 403, message: 'User not authorized for this organization' });
    }

    // Upsert pricingSettings document atomically
    const existing = await db.collection('pricingSettings').findOne({ organizationId, isActive: true });
    const updatePayload = {
      ...validation.sanitized,
      updatedBy: user.email,
      updatedAt: new Date(),
    };

    let resultDoc;
    if (existing) {
      await db.collection('pricingSettings').updateOne(
        { _id: existing._id },
        {
          $set: {
            ...updatePayload,
            version: (existing.version || 1) + 1,
          },
          $push: {
            auditTrail: {
              action: 'updated',
              performedBy: user.email,
              timestamp: new Date(),
              changes: 'General settings updated'
            }
          }
        }
      );
      resultDoc = await db.collection('pricingSettings').findOne({ _id: existing._id });
    } else {
      const doc = {
        _id: new ObjectId(),
        organizationId,
        ...updatePayload,
        createdBy: user.email,
        createdAt: new Date(),
        isActive: true,
        version: 1,
        auditTrail: [{
          action: 'created',
          performedBy: user.email,
          timestamp: new Date(),
          changes: 'General settings created'
        }]
      };
      await db.collection('pricingSettings').insertOne(doc);
      resultDoc = doc;
    }

    // Audit log (best-effort)
    try {
      await createAuditLog({
        action: AUDIT_ACTIONS.UPDATE,
        entityType: AUDIT_ENTITIES.PRICING,
        entityId: (resultDoc._id || resultDoc.id || '').toString(),
        userEmail: user.email,
        organizationId,
        newValues: validation.sanitized,
        reason: 'Updated general settings',
        metadata: { setting: 'generalSettings' }
      });
    } catch (auditError) {
      // Do not fail the API call if audit logging fails
      console.error('Audit log failure in updateGeneralSettings:', auditError);
    }

    return res.status(200).json({
      statusCode: 200,
      message: 'General settings updated',
      data: {
        organizationId,
        ...validation.sanitized,
        updatedAt: resultDoc.updatedAt,
        updatedBy: resultDoc.updatedBy,
        version: resultDoc.version,
      }
    });
  } catch (error) {
    console.error('Error updating general settings:', error);
    return res.status(500).json({ statusCode: 500, message: 'Server error updating general settings' });
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * POST fallback to update general settings (same logic as PUT)
 */
async function createOrUpdateGeneralSettings(req, res) {
  return updateGeneralSettings(req, res);
}

module.exports = {
  updateGeneralSettings,
  createOrUpdateGeneralSettings,
  validateGeneralSettingsPayload,
};