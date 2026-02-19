const { AdminInvoiceProfileService } = require('../services/adminInvoiceProfileService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

class AdminInvoiceProfileController {
  createProfile = catchAsync(async (req, res) => {
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
    } finally {
      await service.disconnect();
    }
  });

  getActiveProfile = catchAsync(async (req, res) => {
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
    } finally {
      await service.disconnect();
    }
  });

  updateProfile = catchAsync(async (req, res) => {
    const service = new AdminInvoiceProfileService();
    try {
      const { profileId } = req.params;
      const updates = req.body || {};
      const result = await service.updateProfile(profileId, updates);
      if (!result.success) {
        return res.status(404).json({ success: false, message: result.error });
      }
      res.status(200).json({ success: true, data: result.data });
    } finally {
      await service.disconnect();
    }
  });

  deleteProfile = catchAsync(async (req, res) => {
    const service = new AdminInvoiceProfileService();
    try {
      const { profileId } = req.params;
      const result = await service.deleteProfile(profileId);
      if (!result.success) {
        return res.status(404).json({ success: false, message: result.error });
      }
      res.status(200).json({ success: true, data: result.data });
    } finally {
      await service.disconnect();
    }
  });
}

module.exports = new AdminInvoiceProfileController();
