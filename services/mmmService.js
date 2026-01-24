/**
 * MMM Service
 * Provides helpers to derive NDIA Modified Monash Model (MMM) ratings
 * from service delivery location (postcode) and apply the correct
 * Remote/Very Remote price loading multipliers to NDIS price caps.
 *
 * NDIA pricing multipliers (2024–25):
 * - MMM 1–5: 1.00 (no loading)
 * - MMM 6 (Remote): 1.40
 * - MMM 7 (Very Remote): 1.50
 *
 * This service expects a backend collection `mmmLocations` seeded with
 * NDIA MMM mappings by postcode (including the Isolated Towns Modification).
 * Optional overrides may exist in `mmmOverrides` to reclassify specific
 * locations for pricing purposes.
 */

const MmmLocation = require('../models/MmmLocation');
const MmmOverride = require('../models/MmmOverride');
const logger = require('../config/logger');

class MmmService {
  /**
   * Normalize a postcode to a 4-digit numeric string.
   * @param {string|number} postcode
   * @returns {string|null}
   */
  normalizePostcode(postcode) {
    if (postcode === undefined || postcode === null) return null;
    const str = String(postcode).trim();
    const digits = str.replace(/[^0-9]/g, '');
    if (!digits) return null;
    return digits;
  }

  /**
   * Get MMM rating for a given postcode.
   * Looks up `mmmOverrides` first, then `mmmLocations`.
   * @param {string|number} postcode
   * @returns {Promise<{mmm:number, source:string, notes?:string} | null>}
   */
  async getMmmByPostcode(postcode) {
    const normalized = this.normalizePostcode(postcode);
    if (!normalized) return null;

    try {
      // 1) Check overrides (Isolated Towns Modification or org-specific policies)
      const override = await MmmOverride.findOne({ postcode: normalized });
      if (override && typeof override.mmm === 'number') {
        return {
          mmm: override.mmm,
          source: 'NDIA MMM (override)',
          notes: override.notes || 'Overridden classification for pricing purposes'
        };
      }

      // 2) Fallback to canonical MMM locations mapping
      const record = await MmmLocation.findOne({ postcode: normalized });
      if (record && typeof record.mmm === 'number') {
        return {
          mmm: record.mmm,
          source: 'NDIA MMM 2024-25',
          notes: record.locationName ? `Location: ${record.locationName}` : undefined
        };
      }

      // No mapping found
      return null;
    } catch (error) {
      logger.warn('MMM lookup failed', {
        error: error.message,
        stack: error.stack,
        postcode: normalized
      });
      return null;
    }
  }

  /**
   * Get multiplier for a given MMM rating.
   * @param {number} mmm - 1..7
   * @returns {number} multiplier
   */
  getMultiplierForMmm(mmm) {
    if (typeof mmm !== 'number') return 1.0;
    if (mmm >= 1 && mmm <= 5) return 1.0;
    if (mmm === 6) return 1.4;
    if (mmm === 7) return 1.5;
    return 1.0;
  }

  /**
   * Apply MMM multiplier to a base price cap.
   * @param {number} baseCap
   * @param {number} mmm
   * @returns {{adjustedCap:number, multiplier:number}}
   */
  applyMultiplierToCap(baseCap, mmm) {
    const multiplier = this.getMultiplierForMmm(mmm);
    if (typeof baseCap !== 'number' || isNaN(baseCap)) {
      return { adjustedCap: baseCap, multiplier };
    }
    return { adjustedCap: baseCap * multiplier, multiplier };
  }
}

const mmmService = new MmmService();

module.exports = {
  MmmService,
  mmmService
};
