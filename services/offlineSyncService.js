/**
 * Offline Sync Service
 * Manages offline data synchronization and conflict resolution
 */

class OfflineSyncService {
  /**
   * Queue offline data for later sync
   * @param {Object} data - Data to queue
   * @returns {Object} Queue result
   */
  async queueOfflineData(data) {
    try {
      const { userId, dataType, action, payload, timestamp } = data;
      
      if (!userId || !dataType || !action || !payload) {
        return {
          success: false,
          message: 'Missing required fields: userId, dataType, action, payload'
        };
      }
      
      // In production, store in database queue table
      // For now, return mock success
      
      const queueItem = {
        queueId: `QUEUE-${Date.now()}`,
        userId,
        dataType,
        action,
        payload,
        timestamp: timestamp || new Date().toISOString(),
        status: 'queued',
        retryCount: 0
      };
      
      return {
        success: true,
        data: queueItem
      };
    } catch (error) {
      console.error('Error queueing offline data:', error);
      return {
        success: false,
        message: 'Failed to queue data',
        error: error.message
      };
    }
  }
  
  /**
   * Sync offline data to server
   * @param {string} userId - User ID
   * @param {Array} queueItems - Queue items to sync
   * @returns {Object} Sync results
   */
  async syncOfflineData(userId, queueItems) {
    try {
      if (!userId || !queueItems || !Array.isArray(queueItems)) {
        return {
          success: false,
          message: 'User ID and queue items array are required'
        };
      }
      
      const results = {
        total: queueItems.length,
        successful: 0,
        failed: 0,
        conflicts: 0,
        items: []
      };
      
      for (const item of queueItems) {
        try {
          // Validate data
          const validation = await this.validateOfflineData(item);
          
          if (!validation.isValid) {
            results.failed++;
            results.items.push({
              queueId: item.queueId,
              status: 'failed',
              reason: validation.reason
            });
            continue;
          }
          
          // Check for conflicts
          const conflict = await this.detectConflict(item);
          
          if (conflict.hasConflict) {
            results.conflicts++;
            results.items.push({
              queueId: item.queueId,
              status: 'conflict',
              conflictData: conflict.data
            });
            continue;
          }
          
          // Process sync based on data type and action
          const syncResult = await this.processSyncItem(item);
          
          if (syncResult.success) {
            results.successful++;
            results.items.push({
              queueId: item.queueId,
              status: 'synced',
              syncedAt: new Date().toISOString()
            });
          } else {
            results.failed++;
            results.items.push({
              queueId: item.queueId,
              status: 'failed',
              reason: syncResult.message
            });
          }
        } catch (itemError) {
          results.failed++;
          results.items.push({
            queueId: item.queueId,
            status: 'failed',
            reason: itemError.message
          });
        }
      }
      
      return {
        success: true,
        data: results
      };
    } catch (error) {
      console.error('Error syncing offline data:', error);
      return {
        success: false,
        message: 'Failed to sync data',
        error: error.message
      };
    }
  }
  
  /**
   * Validate offline data before sync
   * @param {Object} item - Queue item
   * @returns {Object} Validation result
   */
  async validateOfflineData(item) {
    try {
      const { dataType, action, payload } = item;
      
      // Check required fields
      if (!dataType || !action || !payload) {
        return {
          isValid: false,
          reason: 'Missing required fields'
        };
      }
      
      // Validate based on data type
      switch (dataType) {
        case 'timesheet':
          if (!payload.clockIn || !payload.clockOut) {
            return {
              isValid: false,
              reason: 'Timesheet must have clockIn and clockOut times'
            };
          }
          break;
          
        case 'note':
          if (!payload.content || !payload.clientId) {
            return {
              isValid: false,
              reason: 'Note must have content and clientId'
            };
          }
          break;
          
        case 'expense':
          if (!payload.amount || !payload.category) {
            return {
              isValid: false,
              reason: 'Expense must have amount and category'
            };
          }
          break;
          
        default:
          // Generic validation
          if (Object.keys(payload).length === 0) {
            return {
              isValid: false,
              reason: 'Payload cannot be empty'
            };
          }
      }
      
      return {
        isValid: true
      };
    } catch (error) {
      return {
        isValid: false,
        reason: error.message
      };
    }
  }
  
  /**
   * Detect sync conflicts
   * @param {Object} item - Queue item
   * @returns {Object} Conflict detection result
   */
  async detectConflict(item) {
    try {
      const { dataType, action, payload } = item;
      
      // In production, check database for conflicts
      // For now, simulate conflict detection
      
      // Mock: 5% chance of conflict
      const hasConflict = Math.random() < 0.05;
      
      if (hasConflict) {
        return {
          hasConflict: true,
          data: {
            conflictType: 'version_mismatch',
            localVersion: payload.version || 1,
            serverVersion: (payload.version || 1) + 1,
            conflictFields: ['updatedAt'],
            resolution: 'manual'
          }
        };
      }
      
      return {
        hasConflict: false
      };
    } catch (error) {
      console.error('Error detecting conflict:', error);
      return {
        hasConflict: false
      };
    }
  }
  
  /**
   * Process individual sync item
   * @param {Object} item - Queue item
   * @returns {Object} Process result
   */
  async processSyncItem(item) {
    try {
      const { dataType, action, payload } = item;
      
      // In production, perform actual database operations
      // For now, return mock success
      
      switch (action) {
        case 'create':
          // Create new record
          return {
            success: true,
            message: `Created ${dataType} record`,
            recordId: `${dataType.toUpperCase()}-${Date.now()}`
          };
          
        case 'update':
          // Update existing record
          return {
            success: true,
            message: `Updated ${dataType} record`,
            recordId: payload.id || `${dataType.toUpperCase()}-${Date.now()}`
          };
          
        case 'delete':
          // Delete record
          return {
            success: true,
            message: `Deleted ${dataType} record`,
            recordId: payload.id
          };
          
        default:
          return {
            success: false,
            message: `Unknown action: ${action}`
          };
      }
    } catch (error) {
      return {
        success: false,
        message: error.message
      };
    }
  }
  
  /**
   * Resolve sync conflict
   * @param {string} conflictId - Conflict ID
   * @param {string} resolution - Resolution strategy (server, client, merge)
   * @param {Object} mergedData - Merged data if resolution is 'merge'
   * @returns {Object} Resolution result
   */
  async resolveConflict(conflictId, resolution, mergedData = null) {
    try {
      if (!conflictId || !resolution) {
        return {
          success: false,
          message: 'Conflict ID and resolution strategy are required'
        };
      }
      
      const validResolutions = ['server', 'client', 'merge'];
      if (!validResolutions.includes(resolution)) {
        return {
          success: false,
          message: `Invalid resolution strategy. Must be one of: ${validResolutions.join(', ')}`
        };
      }
      
      if (resolution === 'merge' && !mergedData) {
        return {
          success: false,
          message: 'Merged data is required for merge resolution'
        };
      }
      
      // In production, apply resolution to database
      // For now, return mock success
      
      return {
        success: true,
        data: {
          conflictId,
          resolution,
          resolvedAt: new Date().toISOString(),
          finalData: mergedData || { resolution }
        }
      };
    } catch (error) {
      console.error('Error resolving conflict:', error);
      return {
        success: false,
        message: 'Failed to resolve conflict',
        error: error.message
      };
    }
  }
  
  /**
   * Get offline-capable data for user
   * @param {string} userId - User ID
   * @returns {Object} Offline data package
   */
  async getOfflineCapableData(userId) {
    try {
      if (!userId) {
        return {
          success: false,
          message: 'User ID is required'
        };
      }
      
      // In production, fetch user's appointments, clients, etc.
      // For now, return mock data
      
      const offlineData = {
        userId,
        downloadedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        data: {
          appointments: [
            {
              id: 'APT-1',
              clientName: 'John Doe',
              date: new Date().toISOString().split('T')[0],
              startTime: '09:00',
              endTime: '11:00',
              address: '123 Main St',
              notes: 'Regular check-in'
            }
          ],
          clients: [
            {
              id: 'CLIENT-1',
              name: 'John Doe',
              address: '123 Main St',
              phone: '0400 000 000',
              emergencyContact: '0400 000 001'
            }
          ],
          forms: [
            {
              id: 'FORM-1',
              name: 'Daily Check-in Form',
              fields: ['mood', 'activities', 'notes']
            }
          ]
        }
      };
      
      return {
        success: true,
        data: offlineData
      };
    } catch (error) {
      console.error('Error getting offline data:', error);
      return {
        success: false,
        message: 'Failed to get offline data',
        error: error.message
      };
    }
  }
}

module.exports = new OfflineSyncService();
