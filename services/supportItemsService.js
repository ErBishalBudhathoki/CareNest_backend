const { getDatabase } = require('../config/database');
const ndisCatalogSyncService = require('./ndisCatalogSyncService');

class SupportItemsService {
  async _resolveSupportItemsCollection(db) {
    const canonicalCollection = db.collection('support_items');
    try {
      const canonicalCount = await canonicalCollection.estimatedDocumentCount();
      if (canonicalCount > 0) {
        return canonicalCollection;
      }
    } catch (_) {}

    const legacyCollection = db.collection('supportItems');
    try {
      const legacyCount = await legacyCollection.estimatedDocumentCount();
      if (legacyCount > 0) {
        return legacyCollection;
      }
    } catch (_) {}

    return canonicalCollection;
  }

  /**
   * Search support items by text query
   */
  async searchSupportItems(searchQuery) {
    await ndisCatalogSyncService.ensureFreshOnAccess({
      reason: 'support_items_search',
    });

    const db = await getDatabase();
    const collection = await this._resolveSupportItemsCollection(db);
    const query = (searchQuery || '').trim();

    if (!query) {
      return [];
    }

    try {
      return await collection
        .find({ $text: { $search: query } })
        .limit(20)
        .toArray();
    } catch (_) {
      // Fallback when text indexes are not available in the selected collection.
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return await collection
        .find({
          $or: [
            { supportItemName: { $regex: escapedQuery, $options: 'i' } },
            { supportItemNumber: { $regex: escapedQuery, $options: 'i' } },
          ],
        })
        .limit(20)
        .toArray();
    }
  }
  
  /**
   * Get all support items
   */
  async getAllSupportItems() {
    await ndisCatalogSyncService.ensureFreshOnAccess({
      reason: 'support_items_all',
    });

    const db = await getDatabase();
    const collection = await this._resolveSupportItemsCollection(db);

    const items = await collection
      .find({})
      .limit(5000)
      .toArray();
      
    return items;
  }
}

module.exports = new SupportItemsService();
