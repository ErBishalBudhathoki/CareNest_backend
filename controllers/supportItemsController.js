const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const supportItemsService = require('../services/supportItemsService');

class SupportItemsController {
  /**
   * Search support items
   * GET /api/support-items/search?q=...
   */
  searchSupportItems = catchAsync(async (req, res) => {
    const searchQuery = req.query.q;

    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Search query is required'
      });
    }

    const items = await supportItemsService.searchSupportItems(searchQuery);

    logger.business('Support items searched', {
      action: 'SUPPORT_ITEMS_SEARCHED',
      searchQuery,
      resultCount: items?.length || 0
    });

    res.status(200).json({
      success: true,
      code: 'SUPPORT_ITEMS_RETRIEVED',
      items
    });
  });

  /**
   * Get all support items
   * GET /api/support-items/all
   */
  getAllSupportItems = catchAsync(async (req, res) => {
    const items = await supportItemsService.getAllSupportItems();

    logger.business('All support items retrieved', {
      action: 'ALL_SUPPORT_ITEMS_RETRIEVED',
      itemCount: items?.length || 0
    });

    res.status(200).json({
      success: true,
      code: 'ALL_SUPPORT_ITEMS_RETRIEVED',
      items
    });
  });
}

module.exports = new SupportItemsController();
