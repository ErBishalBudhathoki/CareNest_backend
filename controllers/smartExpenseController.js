const smartExpenseService = require('../services/smartExpenseService');

/**
 * Smart Expense Controller
 * Handles smart expense API endpoints
 */

class SmartExpenseController {
  /**
   * Scan receipt using OCR
   * POST /api/expenses/scan-receipt
   * Body: { imageBase64 }
   */
  async scanReceipt(req, res) {
    try {
      const { imageBase64 } = req.body;
      
      if (!imageBase64) {
        return res.status(400).json({
          success: false,
          message: 'Image data is required'
        });
      }
      
      const result = await smartExpenseService.scanReceipt(imageBase64);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in scanReceipt controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Categorize expense using AI
   * POST /api/expenses/categorize
   * Body: { merchant, items, amount }
   */
  async categorizeExpense(req, res) {
    try {
      const expenseData = req.body;
      
      if (!expenseData.merchant && !expenseData.items) {
        return res.status(400).json({
          success: false,
          message: 'Merchant or items data is required'
        });
      }
      
      const result = await smartExpenseService.categorizeExpense(expenseData);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in categorizeExpense controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Validate expense against policy
   * POST /api/expenses/validate-policy
   * Body: { category, amount, date }
   */
  async validateExpensePolicy(req, res) {
    try {
      const expenseData = req.body;
      
      if (!expenseData.category || !expenseData.amount) {
        return res.status(400).json({
          success: false,
          message: 'Category and amount are required'
        });
      }
      
      const result = await smartExpenseService.validateExpensePolicy(expenseData);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in validateExpensePolicy controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Detect duplicate receipt
   * POST /api/expenses/detect-duplicate
   * Body: { receiptHash }
   */
  async detectDuplicateReceipt(req, res) {
    try {
      const { receiptHash } = req.body;
      
      if (!receiptHash) {
        return res.status(400).json({
          success: false,
          message: 'Receipt hash is required'
        });
      }
      
      const result = await smartExpenseService.detectDuplicateReceipts(receiptHash);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in detectDuplicateReceipt controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Calculate mileage from GPS locations
   * POST /api/expenses/calculate-mileage
   * Body: { locations: [{lat, lng, timestamp}] }
   */
  async calculateMileage(req, res) {
    try {
      const { locations } = req.body;
      
      if (!locations || !Array.isArray(locations)) {
        return res.status(400).json({
          success: false,
          message: 'Locations array is required'
        });
      }
      
      const result = await smartExpenseService.calculateMileage(locations);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(400).json(result);
      }
    } catch (error) {
      console.error('Error in calculateMileage controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
}

module.exports = new SmartExpenseController();
