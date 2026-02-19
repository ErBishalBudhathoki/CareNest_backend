const axios = require('axios');

const shouldRun = Boolean(process.env.TEST_JWT);
const maybeTest = shouldRun ? test : test.skip;

maybeTest('updates general settings', async () => {
  const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';
  const JWT = process.env.TEST_JWT;
  const ORG_ID = process.env.TEST_ORG_ID || 'test-org-123';

  const payload = {
    organizationId: ORG_ID,
    defaultCurrency: 'AUD',
    pricingModel: 'NDIS Standard',
    roundingMethod: 'Round to nearest cent',
    taxCalculation: 'GST Inclusive',
    defaultMarkup: 12.5,
    maxPriceVariation: 5,
    priceHistoryRetention: 365,
    bulkOperationLimit: 500,
    autoUpdatePricing: true,
    enablePriceValidation: true,
    requireApprovalForChanges: false,
    enableBulkOperations: true,
    enablePriceHistory: true,
    enableNotifications: false,
  };

  const resp = await axios.put(`${BACKEND_URL}/api/settings/general`, payload, {
    headers: {
      Authorization: `Bearer ${JWT}`,
    },
    validateStatus: () => true,
  });

  expect(resp.status).toBe(200);
  expect(resp.data).toEqual(
    expect.objectContaining({
      success: true,
    }),
  );
}, 30000);
