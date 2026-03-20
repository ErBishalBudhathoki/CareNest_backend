const bankDetailsService = require('../services/bankDetailsService');
const logger = require('../config/logger');
const catchAsync = require('../utils/catchAsync');

/**
 * BankDetailsController
 * Handles HTTP requests for bank details, delegating to the service.
 */
class BankDetailsController {
  /**
   * Save or update bank details
   * POST /saveBankDetails
   */
  saveBankDetails = catchAsync(async (req, res) => {
    const {
      userEmail,
      organizationId,
      bankName,
      accountName,
      bsb,
      accountNumber
    } = req.body || {};

    const actorEmail = req.user?.email;
    const resolvedOrganizationId =
      organizationId ||
      req.headers['x-organization-id'] ||
      req.user?.lastActiveOrganizationId ||
      req.user?.organizationId;

    const targetUserEmail = userEmail || actorEmail;
    const normalizedBsb = String(bsb || '').replace(/\D/g, '');

    const data = await bankDetailsService.saveBankDetails(
      actorEmail,
      targetUserEmail,
      resolvedOrganizationId,
      {
      bankName,
      accountName,
      bsb: normalizedBsb,
      accountNumber,
      }
    );

    res.status(201).json({
      success: true,
      data,
      message: 'Bank details saved successfully',
    });
  });

  /**
   * Get bank details
   * GET /getBankDetails
   */
  getBankDetails = catchAsync(async (req, res) => {
    const { userEmail, organizationId } = req.query || {};
    const actorEmail = req.user?.email;
    const resolvedOrganizationId =
      organizationId ||
      req.headers['x-organization-id'] ||
      req.user?.lastActiveOrganizationId ||
      req.user?.organizationId;
    const targetUserEmail = userEmail || actorEmail;

    const details = await bankDetailsService.getBankDetails(
      actorEmail,
      targetUserEmail,
      resolvedOrganizationId
    );

    if (!details) {
      return res.status(404).json({ success: false, message: 'Bank details not found' });
    }

    res.status(200).json({ success: true, data: details });
  });
}

module.exports = new BankDetailsController();
