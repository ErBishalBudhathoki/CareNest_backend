const bankDetailsService = require('../services/bankDetailsService');
const logger = require('../config/logger');

/**
 * BankDetailsController
 * Handles HTTP requests for bank details, delegating to the service.
 */
class BankDetailsController {
  /**
   * Save or update bank details
   * POST /saveBankDetails
   */
  async saveBankDetails(req, res) {
    try {
      const { userEmail, organizationId, bankName, accountName, bsb, accountNumber } = req.body || {};

      const data = await bankDetailsService.saveBankDetails(userEmail, organizationId, {
        bankName,
        accountName,
        bsb,
        accountNumber,
      });

      return res.status(201).json({
        success: true,
        data,
        message: 'Bank details saved successfully',
      });
    } catch (error) {
      logger.error('Error saving bank details', { error: error.message });
      const status = error.status || 500;
      return res.status(status).json({ success: false, message: error.message || 'Internal server error' });
    }
  }

  /**
   * Get bank details
   * GET /getBankDetails
   */
  async getBankDetails(req, res) {
    try {
      const { userEmail, organizationId } = req.query || {};
      const details = await bankDetailsService.getBankDetails(userEmail, organizationId);

      if (!details) {
        return res.status(404).json({ success: false, message: 'Bank details not found' });
      }

      return res.status(200).json({ success: true, data: details });
    } catch (error) {
      logger.error('Error getting bank details', { error: error.message });
      const status = error.status || 500;
      return res.status(status).json({ success: false, message: error.message || 'Internal server error' });
    }
  }
}

module.exports = new BankDetailsController();