/**
 * Test decoupling invoice generation from strict ClientAssignment requirement.
 * Ensures shifts and worked times can be invoiced when no ClientAssignment exists.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

const mockClientFindOne = jest.fn();
jest.mock('../../models/Client', () => ({
  findOne: (...args) => mockClientFindOne(...args),
}));

const mockAssignmentFindOne = jest.fn();
jest.mock('../../models/ClientAssignment', () => ({
  findOne: (...args) => mockAssignmentFindOne(...args),
}));

const mockShiftFind = jest.fn();
jest.mock('../../models/Shift', () => ({
  find: (...args) => mockShiftFind(...args),
}));

const mockWorkedTimeFind = jest.fn();
jest.mock('../../models/WorkedTime', () => ({
  find: (...args) => mockWorkedTimeFind(...args),
}));

jest.mock('../../models/Expense', () => ({}));
jest.mock('../../models/CustomPricing', () => ({}));
jest.mock('../../models/PricingSettings', () => ({}));
jest.mock('../../models/SupportItem', () => ({}));
jest.mock('../../models/Organization', () => ({}));
jest.mock('../../services/priceValidationService', () => ({ priceValidationService: {} }));
jest.mock('../../services/tripService', () => ({}));

const invoiceGenerationService = require('../../services/invoiceGenerationService');

describe('invoiceGenerationService — decoupled assignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('succeeds without ClientAssignment when WorkedTime entries exist', async () => {
    mockClientFindOne.mockResolvedValue({
      _id: 'client-123',
      clientEmail: 'client@org.com',
      organizationId: 'org-1',
      clientZip: '2000',
    });

    // No assignment
    mockAssignmentFindOne.mockResolvedValue(null);

    // Worked time exists
    mockWorkedTimeFind.mockResolvedValue([
      {
        shiftDate: '2026-10-15',
        timeWorked: '02:00:00',
        ndisItem: { itemNumber: '01_011_0107_1_1', itemName: 'Daily living' },
      },
    ]);

    jest.spyOn(invoiceGenerationService, 'getNdisItemDetails').mockResolvedValue({
      itemNumber: '01_011_0107_1_1',
      itemName: 'Daily living',
      unit: 'H',
    });

    jest.spyOn(invoiceGenerationService, 'getPricingForItem').mockResolvedValue({
      price: 70,
      capRatio: 1,
      priceCapApplied: 70,
      priceCapBase: 70,
      mmmRating: 1,
      mmmMultiplier: 1,
    });

    jest.spyOn(invoiceGenerationService, 'validateInvoiceLineItems').mockResolvedValue({
      isValid: true,
      errors: [],
      warnings: [],
    });

    const result = await invoiceGenerationService.generateInvoiceLineItems(
      'worker@org.com',
      'client@org.com',
      '2026-10-01',
      '2026-10-31'
    );

    expect(result.success).toBe(true);
    expect(result.metadata.assignmentId).toBeNull();
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0].quantity).toBe(2);
    expect(result.lineItems[0].totalPrice).toBe(140);
  });

  test('throws error when neither assignment, nor worked time, nor shifts exist', async () => {
    mockClientFindOne.mockResolvedValue({
      _id: 'client-123',
      clientEmail: 'client@org.com',
      organizationId: 'org-1',
    });

    mockAssignmentFindOne.mockResolvedValue(null);
    mockWorkedTimeFind.mockResolvedValue([]);
    mockShiftFind.mockResolvedValue([]);

    await expect(
      invoiceGenerationService.generateInvoiceLineItems(
        'worker@org.com',
        'client@org.com',
        '2026-10-01',
        '2026-10-31'
      )
    ).rejects.toThrow('No active assignment or shifts found for the specified user and client');
  });

  test('succeeds when assignment is null and worked time is empty, but shifts exist', async () => {
    mockClientFindOne.mockResolvedValue({
      _id: 'client-123',
      clientEmail: 'client@org.com',
      organizationId: 'org-1',
      clientZip: '2000',
    });

    mockAssignmentFindOne.mockResolvedValue(null);
    mockWorkedTimeFind.mockResolvedValue([]);
    mockShiftFind.mockResolvedValue([
      {
        _id: 'shift-1',
        organizationId: 'org-1',
        clientId: 'client-123',
        startTime: new Date('2026-10-05T09:00:00Z'),
        endTime: new Date('2026-10-05T11:00:00Z'),
        isActive: true,
      },
    ]);

    jest.spyOn(invoiceGenerationService, 'validateInvoiceLineItems').mockResolvedValue({
      isValid: true,
      errors: [],
      warnings: [],
    });

    const result = await invoiceGenerationService.generateInvoiceLineItems(
      'worker@org.com',
      'client@org.com',
      '2026-10-01',
      '2026-10-31'
    );

    expect(result.success).toBe(true);
    expect(result.metadata.assignmentId).toBeNull();
    expect(mockShiftFind).toHaveBeenCalled();
  });

  test('throws error when client is not found or inactive', async () => {
    mockClientFindOne.mockResolvedValue(null);

    await expect(
      invoiceGenerationService.generateInvoiceLineItems(
        'worker@org.com',
        'inactive@org.com',
        '2026-10-01',
        '2026-10-31'
      )
    ).rejects.toThrow('Client not found or inactive');
  });

  test('createLineItemFromWorkedTime safely handles null assignment and falls back', async () => {
    const client = {
      _id: 'client-123',
      organizationId: 'org-1',
      clientZip: '3000',
    };

    jest.spyOn(invoiceGenerationService, 'getNdisItemDetails').mockResolvedValue({
      itemNumber: '01_001_0107_1_1',
      itemName: 'Daily support',
      unit: 'H',
    });

    const pricingSpy = jest.spyOn(invoiceGenerationService, 'getPricingForItem').mockResolvedValue({
      price: 60,
      capRatio: 1,
      basePrice: 60,
      isCustom: false,
      ndisCompliant: true,
    });

    const workEntry = {
      date: '2026-10-10',
      timeWorked: '01:30:00',
      serviceLocationPostcode: '3005',
    };

    const lineItem = await invoiceGenerationService.createLineItemFromWorkedTime(
      workEntry,
      null,
      client
    );

    expect(lineItem).not.toBeNull();
    expect(lineItem.assignmentId).toBeNull();
    expect(lineItem.ndisItemNumber).toBe('01_001_0107_1_1');
    expect(lineItem.serviceLocationPostcode).toBe('3005');
    expect(lineItem.quantity).toBe(1.5);
    expect(lineItem.unitPrice).toBe(60);
    expect(lineItem.totalPrice).toBe(90);
  });
});
