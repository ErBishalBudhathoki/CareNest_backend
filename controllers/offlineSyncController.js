const offlineSyncService = require('../services/offlineSyncService');

/**
 * Offline Sync Controller
 * Handles offline sync API endpoints
 */

class OfflineSyncController {
  /**
   * Queue offline data
   * POST /api/offline/queue
   * Body: { userId, dataType, action, payload, timestamp }
   */
  async queueOfflineData(req, res) {
    try {
      const data = req.body;
      
      if (!data.userId || !data.dataType || !data.action || !data.payload) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: userId, dataType, action, payload'
        });
      }
      
      const result = await offlineSyncService.queueOfflineData(data);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(400).json(result);
      }
    } catch (error) {
      console.error('Error in queueOfflineData controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Sync offline data
   * POST /api/offline/sync
   * Body: { userId, queueItems }
   */
  async syncOfflineData(req, res) {
    try {
      const { userId, queueItems } = req.body;
      
      if (!userId || !queueItems || !Array.isArray(queueItems)) {
        return res.status(400).json({
          success: false,
          message: 'User ID and queue items array are required'
        });
      }
      
      const result = await offlineSyncService.syncOfflineData(userId, queueItems);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in syncOfflineData controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Get offline-capable data
   * GET /api/offline/data/:userId
   */
  async getOfflineCapableData(req, res) {
    try {
      const { userId } = req.params;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required'
        });
      }
      
      const result = await offlineSyncService.getOfflineCapableData(userId);
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }
    } catch (error) {
      console.error('Error in getOfflineCapableData controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
  
  /**
   * Resolve sync conflict
   * POST /api/offline/resolve-conflict
   * Body: { conflictId, resolution, mergedData }
   */
  async resolveConflict(req, res) {
    try {
      const { conflictId, resolution, mergedData } = req.body;
      
      if (!conflictId || !resolution) {
        return res.status(400).json({
          success: false,
          message: 'Conflict ID and resolution strategy are required'
        });
      }
      
      const result = await offlineSyncService.resolveConflict(
        conflictId,
        resolution,
        mergedData
      );
      
      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(400).json(result);
      }
    } catch (error) {
      console.error('Error in resolveConflict controller:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
}

module.exports = new OfflineSyncController();
