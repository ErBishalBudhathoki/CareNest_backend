const { proxyActivities } = require('@temporalio/workflow');

const { jwtRotationCheckActivity, ndisCatalogSyncActivity } = proxyActivities({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '1 minute',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

/**
 * Weekly JWT rotation policy check (keys older than maxKeyAgeDays rotate).
 */
async function JwtRotationCheckWorkflow({ maxKeyAgeDays = 30 } = {}) {
  const result = await jwtRotationCheckActivity({ maxKeyAgeDays });
  return result;
}

/**
 * Daily NDIS catalog sync tick (no-op when the source is unchanged).
 */
async function NdisCatalogSyncWorkflow({ reason = 'scheduled' } = {}) {
  const result = await ndisCatalogSyncActivity({ reason });
  return result;
}

module.exports = {
  JwtRotationCheckWorkflow,
  NdisCatalogSyncWorkflow,
};
