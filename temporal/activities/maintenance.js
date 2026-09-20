const logger = require('../../config/logger');
const keyRotationService = require('../../services/jwtKeyRotationService');
const ndisCatalogSyncService = require('../../services/ndisCatalogSyncService');
const JWTSecret = require('../../models/JWTSecret');

/**
 * Check whether the active JWT key is older than policy and rotate if so.
 * Replaces the in-process setTimeout chain (dies on restart, invisible);
 * the DB is the source of truth so concurrent ticks cannot double-rotate
 * (rotateKeys itself guards with ROTATION_IN_PROGRESS).
 */
async function jwtRotationCheckActivity({ maxKeyAgeDays = 30 } = {}) {
  await keyRotationService.initialize();
  const latest = await JWTSecret.findOne({})
    .sort({ activatedAt: -1, createdAt: -1 })
    .lean();
  const createdAt =
    (latest && (latest.activatedAt || latest.createdAt)) || null;
  const ageDays = createdAt
    ? (Date.now() - new Date(createdAt).getTime()) / 86400000
    : Infinity;
  if (ageDays < maxKeyAgeDays) {
    return { rotated: false, ageDays: Math.round(ageDays * 100) / 100 };
  }
  const result = await keyRotationService.rotateKeys({
    rotationType: 'scheduled',
  });
  logger.info('[Temporal] Scheduled JWT rotation completed', {
    newKeyId: result.newKey && result.newKey.keyId,
  });
  return {
    rotated: true,
    newKeyId: result.newKey && result.newKey.keyId,
  };
}

/**
 * Sync the NDIS support-item catalog into MongoDB when the source changed.
 * syncIfChanged is a no-op when nothing changed (cheap daily tick).
 */
async function ndisCatalogSyncActivity({ reason = 'scheduled' } = {}) {
  const result = await ndisCatalogSyncService.syncIfChanged({ reason });
  logger.info('[Temporal] NDIS catalog sync tick', {
    skipped: !!(result && result.skipped),
    reason,
  });
  return {
    skipped: !!(result && result.skipped),
    result: result && typeof result === 'object' ? result : { ok: true },
  };
}

module.exports = {
  jwtRotationCheckActivity,
  ndisCatalogSyncActivity,
};
