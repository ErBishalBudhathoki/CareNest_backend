jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../../config/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), business: jest.fn() }));
jest.mock('../../services/ndisCatalogSyncService', () => ({ ensureFreshOnAccess: jest.fn() }));
jest.mock('../../services/mmmService', () => ({ mmmService: {
  getMmmByPostcode: jest.fn().mockResolvedValue({ mmm: 7 }),
  getMultiplierForMmm: jest.fn().mockReturnValue(1.5),
  applyMultiplierToCap: jest.fn((cap, rating) => ({ adjustedCap: cap * (rating ? 1.5 : 1) }))
} }));
jest.mock('../../models/SupportItem', () => ({ findOne: jest.fn(), find: jest.fn() }));

jest.mock('mongoose', () => ({ Types: { ObjectId: class ObjectId { constructor(v) { this.value = v; } static isValid(v) { return typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v) || /^[0-9a-f]{24}$/.test(String(v)); } } } }));
jest.mock('../../models/CustomPricing', () => ({ findOne: jest.fn(), create: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../models/Client', () => ({ findOne: jest.fn() }));
jest.mock('../../models/User', () => ({}));
jest.mock('../../models/PricingSettings', () => ({ findOne: jest.fn() }));
jest.mock('../../models/ClientAssignment', () => ({ findOne: jest.fn() }));
jest.mock('../../models/WorkedTime', () => ({ find: jest.fn() }));
jest.mock('../../models/Expense', () => ({}));
jest.mock('../../models/Organization', () => ({}));
jest.mock('../../services/tripService', () => ({ getBillableTrips: jest.fn().mockResolvedValue([]) }));
jest.mock('../../services/auditService', () => ({ createAuditLog: jest.fn() }));
jest.mock('../../services/cacheService', () => ({ get: jest.fn(), set: jest.fn(), clearPattern: jest.fn() }));

const CustomPricing = require('../../models/CustomPricing');
const Client = require('../../models/Client');
const PricingSettings = require('../../models/PricingSettings');
const pricingService = require('../../services/pricingService');
const invoiceService = require('../../services/invoiceGenerationService');
const SupportItem = require('../../models/SupportItem');
const { priceValidationService: validator } = require('../../services/priceValidationService');
const { mmmService } = require('../../services/mmmService');

const validatePriceSpy = jest.spyOn(validator, 'validatePrice');

const dbPricing = overrides => {
  const base = { customPrice: 50, pricingType: 'fixed', region: null, clientSpecific: false, clientId: null, effectiveDate: new Date('2026-01-01'), version: 1, supportItemNumber: 'item', organizationId: 'org1', _id: 'p1', ...overrides };
  return { toObject: () => ({ ...base }), ...base };
};
const orgPricing = region => dbPricing({ region, clientSpecific: false, clientId: null });
const sortable = doc => ({ sort: () => Promise.resolve(doc) });

describe('region persistence', () => {
  beforeEach(() => {
    CustomPricing.create.mockImplementation(async doc => dbPricing({ ...doc, _id: 'new1' }));
    Client.findOne.mockReturnValue({ lean: async () => ({ _id: 'c1', clientEmail: 'w@x.com' }) });
  });

  test('create persists region and validates against its cap', async () => {
    CustomPricing.findOne.mockResolvedValue(null);
    const doc = await pricingService.createCustomPricing({
      organizationId: 'org1', supportItemNumber: 'item', pricingType: 'fixed',
      customPrice: 140, clientSpecific: false, region: 'remote'
    }, 'admin@x.com');
    expect(CustomPricing.create).toHaveBeenCalledWith(expect.objectContaining({ region: 'remote' }));
    expect(doc.region).toBe('remote');
  });

  test('create rejects price above selected region cap and fails closed on missing cap', async () => {
    CustomPricing.findOne.mockResolvedValue(null);
    await expect(pricingService.createCustomPricing({
      organizationId: 'org1', supportItemNumber: 'item', pricingType: 'fixed', customPrice: 141, region: 'remote'
    }, 'a@x.com')).rejects.toMatchObject({ statusCode: 400 });
    SupportItem.findOne.mockResolvedValue(catalogItem({ national: 100, remote: null, veryRemote: 150 }));
    await expect(pricingService.createCustomPricing({
      organizationId: 'org1', supportItemNumber: 'item', pricingType: 'fixed', customPrice: 90, region: 'remote'
    }, 'a@x.com')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('region-only update persists, region omitted retains existing, missing-region update never erases explicit region', async () => {
    CustomPricing.findOne.mockResolvedValue(dbPricing({ region: 'remote' }));
    CustomPricing.findOneAndUpdate.mockResolvedValue(dbPricing({ region: 'veryRemote' }));
    const updated = await pricingService.updateCustomPricing('p1', { region: 'veryRemote' }, 'a@x.com');
    expect(CustomPricing.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'p1' },
      expect.objectContaining({ $set: expect.objectContaining({ region: 'veryRemote' }) }),
      expect.anything()
    );
    expect(updated.region).toBe('veryRemote');

    CustomPricing.findOne.mockResolvedValue(dbPricing({ region: 'remote' }));
    await pricingService.updateCustomPricing('p1', {}, 'a@x.com');
    expect(CustomPricing.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'p1' },
      expect.not.objectContaining({ $set: expect.objectContaining({ region: expect.anything() }) }),
      expect.anything()
    );
  });

  test('assignment upsert saves region on create and region-only update on existing record', async () => {
    CustomPricing.findOne.mockResolvedValue(null);
    await pricingService.processCustomPricing(
      { pricingType: 'fixed', price: 90, region: 'remote' },
      { itemNumber: 'item', itemName: 'Item' }, 'org1', { _id: 'c1' }, 'w@x.com'
    );
    expect(CustomPricing.create).toHaveBeenCalledWith(expect.objectContaining({ region: 'remote' }));

    CustomPricing.findOne.mockResolvedValue(dbPricing({ region: 'national', customPrice: 90, pricingType: 'fixed', _id: 'p1' }));
    await pricingService.processCustomPricing(
      { pricingType: 'fixed', region: 'veryRemote' },
      { itemNumber: 'item', itemName: 'Item' }, 'org1', { _id: 'c1' }, 'w@x.com'
    );
    expect(CustomPricing.updateOne).toHaveBeenCalledWith(
      { _id: 'p1' },
      expect.objectContaining({ $set: expect.objectContaining({ region: 'veryRemote' }) })
    );
  });
});

describe('lookup and invoice precedence', () => {
  beforeEach(() => {
    CustomPricing.findOne.mockReset();
    CustomPricing.findOne.mockImplementation(() => sortable(null));
    CustomPricing.aggregate.mockResolvedValue([]);
    PricingSettings.findOne.mockReturnValue({ lean: async () => null });
    Client.findOne.mockReturnValue({ lean: async () => ({ _id: 'c1', clientEmail: 'c@x.com' }) });
  });

  test('lookup forwards winning override region: client beats org', async () => {
    CustomPricing.findOne
      .mockImplementationOnce(() => sortable(dbPricing({ region: 'remote', clientSpecific: true, clientId: 'c1' })))
      .mockImplementationOnce(() => sortable(orgPricing('national')));
    const result = await pricingService.getPricingLookup('org1', 'item', 'c1');
    expect(result.source).toBe('client_specific');
    const call = validatePriceSpy.mock.calls[0];
    expect(call[5]).toEqual({ region: 'remote' });
  });

  test('org-only override forwards its saved region; ndis default stays regionless', async () => {
    CustomPricing.findOne
      .mockImplementationOnce(() => sortable(orgPricing('veryRemote')));
    await pricingService.getPricingLookup('org1', 'item', null);
    expect(validatePriceSpy.mock.calls[0][5]).toEqual({ region: 'veryRemote' });

    CustomPricing.findOne.mockReset();
    CustomPricing.findOne.mockReturnValue(sortable(null));
    validatePriceSpy.mockClear();
    await pricingService.getPricingLookup('org1', 'item', null);
    expect(validatePriceSpy).not.toHaveBeenCalled();
  });

  test('invoice getPricingForItem client wins over org and carries region; org lookup finds clientId null', async () => {
    CustomPricing.findOne.mockReset();
    const clientPricing = dbPricing({ region: 'remote', clientSpecific: true, clientId: 'c1', customPrice: 90 });
    CustomPricing.findOne
      .mockResolvedValueOnce(clientPricing)
      .mockResolvedValueOnce(null);
    const pricing = await invoiceService.getPricingForItem('item', 'org1', 'c1', 'NSW', 'standard', null);
    expect(pricing.source).toBe('client-specific');
    expect(pricing.pricingMetadata?.region).toBeUndefined();
    expect(validatePriceSpy.mock.calls[0][5]).toEqual(expect.objectContaining({ region: 'remote' }));

    CustomPricing.findOne.mockReset();
    CustomPricing.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(dbPricing({ region: 'veryRemote', clientSpecific: false, clientId: null, customPrice: 60 }));
    validatePriceSpy.mockClear();
    const orgResult = await invoiceService.getPricingForItem('item', 'org1', null, 'NSW', 'standard', null);
    expect(orgResult.source).toBe('organization');
    expect(CustomPricing.findOne).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: null, clientSpecific: { $ne: true } }));
    expect(validatePriceSpy.mock.calls[0][5]).toEqual({ region: 'veryRemote', servicePostcode: null });
  });

  test.each(['schedule', 'workedTime'])('%s preserves the winning region through revalidation', async builder => {
    CustomPricing.findOne.mockResolvedValue(dbPricing({ region: 'remote', customPrice: 145 }));
    const assignment = { _id: 'a1', assignedNdisItemNumber: 'item', ndisItem: { itemNumber: 'item', itemName: 'High intensity support', unit: 'H' } };
    const client = { _id: 'c1', organizationId: 'org1', clientZip: '9999' };
    const details = jest.spyOn(invoiceService, 'getNdisItemDetails').mockResolvedValue(assignment.ndisItem);
    let lineItem;
    try {
      lineItem = builder === 'schedule'
        ? await invoiceService.createLineItemFromSchedule({ date: '2026-09-01', startTime: '09:00', endTime: '10:00', break: 0 }, assignment, client)
        : await invoiceService.createLineItemFromWorkedTime({ date: '2026-09-01', timeWorked: 1 }, assignment, client);
    } finally {
      details.mockRestore();
    }
    expect(lineItem).not.toBeNull();
    expect(lineItem.region).toBe('remote');
    expect(lineItem.pricingMetadata.region).toBe('remote');
    const validation = await invoiceService.validateInvoiceLineItems([lineItem]);
    expect(validation).toMatchObject({ isValid: false, invalidItems: 1 });
    expect(lineItem.pricingMetadata).toMatchObject({ region: 'remote', priceCapApplied: 140 });
    const realtime = await invoiceService.validateLineItemPricing([JSON.parse(JSON.stringify(lineItem))]);
    expect(realtime.results[0]).toMatchObject({ isValid: false, priceCap: 140 });
    expect(mmmService.getMmmByPostcode).not.toHaveBeenCalled();
    expect(mmmService.applyMultiplierToCap).not.toHaveBeenCalled();
  });

  test('preconfigured pricing carries region and replaces stale metadata', async () => {
    CustomPricing.findOne.mockResolvedValue(dbPricing({ region: 'veryRemote', customPrice: 145 }));
    const lineItems = [{ ndisItemNumber: 'item', quantity: 1, unitPrice: 0, region: 'national', pricingMetadata: { region: 'national' }, servicePostcode: '9999' }];
    await invoiceService.applyPreConfiguredPricing(lineItems, 'org1', 'c1');
    expect(lineItems[0]).toMatchObject({ region: 'veryRemote', pricingMetadata: { region: 'veryRemote' } });
    const validation = await invoiceService.validateInvoiceLineItems(lineItems);
    expect(validation.isValid).toBe(true);
    expect(lineItems[0].priceCap).toBe(150);
    expect(mmmService.getMmmByPostcode).not.toHaveBeenCalled();
  });

  test.each([undefined, null, '140', NaN, Infinity, -1, 0])('invoice metadata selected cap %s fails closed', async cap => {
    SupportItem.findOne.mockResolvedValue(catalogItem({ national: 100, remote: cap }));
    const lineItems = [{ ndisItemNumber: 'item', quantity: 1, unitPrice: 90, pricingMetadata: { region: 'remote' }, servicePostcode: '9999' }];
    const validation = await invoiceService.validateInvoiceLineItems(lineItems);
    expect(validation).toMatchObject({ isValid: false, invalidItems: 1 });
    expect(lineItems[0].priceCap).toBeNull();
    expect(mmmService.getMmmByPostcode).not.toHaveBeenCalled();
  });

  test.each(['', false, 'highIntensity'])('invalid invoice region %s fails closed', async region => {
    const { results } = await invoiceService.validateLineItemPricing([{ ndisItemNumber: 'item', unitPrice: 90, region }]);
    expect(results[0]).toMatchObject({ isValid: false, status: 'invalid_region' });
  });

  test('legacy client override does not inherit the organization region', async () => {
    CustomPricing.findOne.mockResolvedValue(dbPricing({ region: undefined, customPrice: 140 }));
    const pricing = await invoiceService.getPricingForItem('item', 'org1', 'c1', 'NSW', 'standard', '9999');
    expect(pricing).toMatchObject({ source: 'client-specific', ndisCompliant: true, priceCap: 150 });
    expect(CustomPricing.findOne).toHaveBeenCalledTimes(1);
    expect(mmmService.getMmmByPostcode).toHaveBeenCalledTimes(1);
    expect(mmmService.applyMultiplierToCap).toHaveBeenCalledTimes(1);
  });

  test('bulk lookup validates saved region against exact regional cap; regionless cp keeps legacy MMM', async () => {
    CustomPricing.aggregate.mockResolvedValue([
      { _id: 'item', pricing: dbPricing({ region: 'remote', customPrice: 141, clientSpecific: false, clientId: null }) },
      { _id: 'item2', pricing: dbPricing({ region: null, customPrice: 140, clientSpecific: false, clientId: null, supportItemNumber: 'item2' }) }
    ]);
    SupportItem.find.mockResolvedValue([
      catalogItem(),
      { supportItemNumber: 'item2', priceCaps: { national: 100, remote: 140, veryRemote: 150 }, supportItemName: 'Two' }
    ]);
    const { data } = await pricingService.getBulkPricingLookup('org1', ['item', 'item2'], null);
    const regionalCall = validatePriceSpy.mock.calls.find(c => c[0] === 'item');
    expect(regionalCall[5]).toEqual({ region: 'remote' });
    expect(data.item.ndisCompliant).toBe(false);
    expect(data.item.priceCap).toBe(140);
    expect(data.item.region).toBe('remote');
    expect(data.item.exceedsNdisCap).toBe(true);
    expect(data.item2.ndisCompliant).toBe(false);
    expect(data.item2.priceCap).toBe(100);
    expect(mmmService.getMmmByPostcode).not.toHaveBeenCalled();
    expect(mmmService.applyMultiplierToCap).toHaveBeenCalledTimes(1);
  });

  test('create and update invalidate pricing cache; assignment upsert does not', async () => {
    const cacheService = require('../../services/cacheService');
    CustomPricing.create.mockImplementation(async doc => dbPricing({ ...doc, _id: 'new1' }));
    CustomPricing.findOne.mockResolvedValue(null);
    await pricingService.createCustomPricing({
      organizationId: 'org1', supportItemNumber: 'item', pricingType: 'fixed', customPrice: 90, region: 'remote'
    }, 'a@x.com');
    expect(cacheService.clearPattern).toHaveBeenCalledWith('pricing:org1:*');
    CustomPricing.findOne.mockResolvedValue(dbPricing({ region: 'remote' }));
    CustomPricing.findOneAndUpdate.mockResolvedValue(dbPricing({ region: 'remote' }));
    await pricingService.updateCustomPricing('p1', { customPrice: 95 }, 'a@x.com');
    expect(cacheService.clearPattern).toHaveBeenCalledTimes(2);
    CustomPricing.findOne.mockResolvedValue(null);
    await pricingService.processCustomPricing(
      { pricingType: 'fixed', price: 90, region: 'remote' },
      { itemNumber: 'item', itemName: 'Item' }, 'org1', { _id: 'c1' }, 'w@x.com'
    );
    expect(cacheService.clearPattern).toHaveBeenCalledTimes(2);
  });

  test('batch realtime validation carries region from line items', async () => {
    CustomPricing.findOne.mockResolvedValue(null);
    const { results } = await invoiceService.validateLineItemPricing([
      { ndisItemNumber: 'item', unitPrice: 145, providerType: 'standard', region: 'remote' }
    ]);
    expect(results[0].priceCap).toBe(140);
    expect(results[0].isValid).toBe(false);
  });

  test('validateInvoiceLineItems attaches winning region to line item metadata', async () => {
    CustomPricing.findOne.mockResolvedValue(null);
    const lineItems = [
      { ndisItemNumber: 'item', unitPrice: 145, quantity: 1, providerType: 'standard', region: 'remote' },
      { ndisItemNumber: 'item', unitPrice: 95, quantity: 1, providerType: 'standard' }
    ];
    const validation = await invoiceService.validateInvoiceLineItems(lineItems);
    expect(validation.isValid).toBe(false);
    expect(lineItems[0].pricingMetadata.region).toBe('remote');
    expect(lineItems[0].pricingMetadata.priceCapApplied).toBe(140);
    expect(lineItems[0].exceedsPriceCap).toBe(true);
    expect(lineItems[1].pricingMetadata.region ?? null).toBe(null);
    expect(lineItems[1].pricingMetadata.priceCapApplied).toBe(100);
    expect(lineItems[1].exceedsPriceCap).toBe(false);
    expect(mmmService.getMmmByPostcode).not.toHaveBeenCalled();
  });
});

const catalogItem = (priceCaps = { national: 100, remote: 140, veryRemote: 150 }) => ({
  supportItemNumber: 'item', priceCaps, startDate: '2020-01-01', endDate: '9999-12-31'
});
const validate = (price, region, extra = {}) => validator.validatePrice(
  'item', price, 'NSW', 'standard', new Date('2026-09-01'), { region, ...extra }
);

beforeEach(() => {
  jest.clearAllMocks();
  SupportItem.findOne.mockResolvedValue(catalogItem());
});

describe('explicit regional caps', () => {
  test.each([['national', 100], ['remote', 140], ['veryRemote', 150]])('%s uses its exact published cap', async (region, cap) => {
    expect(validator.getPriceCap(catalogItem(), 'NSW', 'highIntensity', region)).toBe(cap);
    expect(await validate(cap, region)).toMatchObject({ isValid: true, priceCap: cap });
    expect(await validate(cap + 1, region)).toMatchObject({ isValid: false, status: 'exceeds_cap', priceCap: cap });
  });

  test('explicit published caps never load or apply MMM', async () => {
    expect(await validate(141, 'remote', { servicePostcode: '9999' })).toMatchObject({ isValid: false, priceCap: 140 });
    expect(mmmService.getMmmByPostcode).not.toHaveBeenCalled();
    expect(mmmService.applyMultiplierToCap).not.toHaveBeenCalled();
  });

  test.each([undefined, null, '140', NaN, Infinity, -1, 0])('missing or invalid selected cap %s fails closed', async cap => {
    SupportItem.findOne.mockResolvedValue(catalogItem({ national: 100, remote: cap, veryRemote: 200 }));
    expect(await validate(90, 'remote')).toMatchObject({ isValid: false, status: 'no_cap_found', priceCap: null });
  });

  test('invalid region fails closed', async () => {
    expect(await validate(90, 'highIntensity')).toMatchObject({ isValid: false, status: 'invalid_region' });
  });

  test('omitted region preserves legacy MMM behavior', async () => {
    expect(await validate(140, undefined, { servicePostcode: '9999' })).toMatchObject({ isValid: true, priceCap: 150 });
    expect(mmmService.getMmmByPostcode).toHaveBeenCalledTimes(1);
  });

  test('high intensity does not select a different cap within an item', async () => {
    SupportItem.findOne.mockImplementation(async ({ supportItemNumber }) => catalogItem({ national: supportItemNumber === 'high-item' ? 120 : 100 }));
    const results = await validator.validatePricesBatch([
      { supportItemNumber: 'item', proposedPrice: 110, providerType: 'highIntensity', region: 'national' },
      { supportItemNumber: 'high-item', proposedPrice: 110, providerType: 'standard', region: 'national' }
    ]);
    expect(results.map(r => [r.isValid, r.priceCap])).toEqual([[false, 100], [true, 120]]);
  });
});
