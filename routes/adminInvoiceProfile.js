const express = require('express');
const router = express.Router();
const { AdminInvoiceProfileService } = require('../services/adminInvoiceProfileService');
const logger = require('../config/logger');

/**
 * Create admin invoice profile
 */
router.post('/api/admin-invoice-profile', async (req, res) => {
  const service = new AdminInvoiceProfileService();
  try {
    const { organizationId, businessName, businessAddress, contactEmail, contactPhone, taxIdentifiers, bankDetails } = req.body || {};
    if (!organizationId || !businessName || !businessAddress || !contactEmail || !contactPhone) {
      return res.status(400).json({
        success: false,
        message: 'organizationId, businessName, businessAddress, contactEmail and contactPhone are required',
      });
    }
    const result = await service.createProfile({
      organizationId,
      businessName,
      businessAddress,
      contactEmail,
      contactPhone,
      taxIdentifiers,
      bankDetails,
      isActive: true,
    });
    if (!result.success) {
      return res.status(500).json({ success: false, message: result.error });
    }
    res.status(201).json({ success: true, data: result.data });
  } catch (error) {
    logger.error('Create admin invoice profile failed', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    await service.disconnect();
  }
});

/**
 * Get active admin invoice profile by organization
 */
router.get('/api/admin-invoice-profile/:organizationId', async (req, res) => {
  const service = new AdminInvoiceProfileService();
  try {
    const { organizationId } = req.params;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: 'organizationId is required' });
    }
    const result = await service.getActiveProfileByOrganization(organizationId);
    if (!result.success) {
      return res.status(404).json({ success: false, message: result.error });
    }
    res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    logger.error('Get admin invoice profile failed', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    await service.disconnect();
  }
});

/**
 * Update admin invoice profile
 */
router.put('/api/admin-invoice-profile/:profileId', async (req, res) => {
  const service = new AdminInvoiceProfileService();
  try {
    const { profileId } = req.params;
    const updates = req.body || {};
    const result = await service.updateProfile(profileId, updates);
    if (!result.success) {
      return res.status(404).json({ success: false, message: result.error });
    }
    res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    logger.error('Update admin invoice profile failed', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    await service.disconnect();
  }
});

/**
 * Soft delete admin invoice profile
 */
router.delete('/api/admin-invoice-profile/:profileId', async (req, res) => {
  const service = new AdminInvoiceProfileService();
  try {
    const { profileId } = req.params;
    const result = await service.deleteProfile(profileId);
    if (!result.success) {
      return res.status(404).json({ success: false, message: result.error });
    }
    res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    logger.error('Delete admin invoice profile failed', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, message: 'Internal server error' });
  } finally {
    await service.disconnect();
  }
});

module.exports = router;
