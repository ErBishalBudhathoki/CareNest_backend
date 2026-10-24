jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

const mockShiftFindOne = jest.fn();
jest.mock('../../models/Shift', () => ({
  findOne: (...args) => mockShiftFindOne(...args),
}));

const mockClientFindOne = jest.fn();
jest.mock('../../models/Client', () => ({
  findOne: (...args) => mockClientFindOne(...args),
}));

const mockTripFind = jest.fn();
jest.mock('../../models/Trip', () => ({
  find: (...args) => mockTripFind(...args),
}));

const mockSupportItemFindOne = jest.fn();
jest.mock('../../models/SupportItem', () => ({
  findOne: (...args) => mockSupportItemFindOne(...args),
}));

const mockGenerateInvoiceNumber = jest.fn();
const mockCreateInvoice = jest.fn();
jest.mock('../../services/invoiceManagementService', () => ({
  InvoiceManagementService: {
    generateInvoiceNumber: (...args) => mockGenerateInvoiceNumber(...args),
    createInvoice: (...args) => mockCreateInvoice(...args),
  },
}));

const mockValidatePrice = jest.fn();
jest.mock('../../services/priceValidationService', () => ({
  priceValidationService: {
    validatePrice: (...args) => mockValidatePrice(...args),
  },
}));

const providerTravelService = require('../../services/providerTravelService');

const shift = {
  _id: 's1',
  organizationId: 'org1',
  clientId: 'c1',
  employeeId: 'u1',
  status: 'approved',
  supportItems: [{ itemNumber: '01_011_0107_1_1', itemName: 'Daily living' }],
  startTime: new Date('2026-06-10T09:00:00+10:00'),
  endTime: new Date('2026-06-10T11:00:00+10:00'),
  isActive: true,
  providerTravel: {},
  save: jest.fn(),
};

describe('ProviderTravelService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shift.providerTravel = {};
    shift.save = jest.fn();
    mockShiftFindOne.mockResolvedValue(shift);
    mockClientFindOne.mockReturnValue({
      lean: async () => ({
        clientFirstName: 'Ada',
        clientLastName: 'Nguyen',
        clientEmail: 'ada@example.com',
        clientState: 'NSW',
        fundingType: 'ndia_managed',
      }),
    });
    mockGenerateInvoiceNumber.mockResolvedValue('INV-TR-1');
    mockCreateInvoice.mockImplementation(async (data) => ({
      success: true,
      data: { ...data, _id: 'inv1' },
    }));
    mockValidatePrice.mockImplementation(async (supportNumber) => ({
      priceCap: String(supportNumber).startsWith('01_799_') ? 1.05 : 70,
    }));
  });

  test('bills travel minutes and km as separate line items', async () => {
    const result = await providerTravelService.createTravelCharge(
      'org1',
      {
        shiftId: 's1',
        minutes: 30,
        km: 20,
        labourSupportNumber: '01_011_0107_1_1',
        nonLabourSupportNumber: '01_799_0107_2_1',
      },
      'admin',
    );

    expect(result.amount).toBe(56); // 0.5h × $70 + 20km × $1.05
    const payload = mockCreateInvoice.mock.calls[0][0];
    expect(payload.lineItems).toHaveLength(2);
    expect(payload.lineItems[0]).toMatchObject({
      quantity: 0.5,
      unit: 'H',
      price: 70,
      totalPrice: 35,
    });
    expect(payload.lineItems[1]).toMatchObject({
      quantity: 20,
      unit: 'KM',
      price: 1.05,
      totalPrice: 21,
    });
  });

  test('builds the charge automatically from approved trips', async () => {
    mockTripFind.mockReturnValue({
      lean: async () => [{ distance: 10 }, { distance: 5.5 }],
    });
    mockSupportItemFindOne.mockReturnValue({
      lean: async () => ({ supportItemNumber: '01_799_0107_1_1' }),
    });

    const result = await providerTravelService.createTravelChargeFromTrips(
      'org1',
      { shiftId: 's1' },
      'admin',
    );

    expect(result.km).toBe(15.5);
    expect(result.tripCount).toBe(2);
    const payload = mockCreateInvoice.mock.calls[0][0];
    expect(payload.lineItems[0]).toMatchObject({
      supportItemNumber: '01_799_0107_1_1',
      quantity: 15.5,
      unit: 'KM',
      price: 1.05,
      totalPrice: 16.28,
    });
  });

  test('never bills provider travel twice for the same shift', async () => {
    mockShiftFindOne.mockResolvedValue({
      ...shift,
      providerTravel: { invoiceId: 'inv-existing' },
    });
    const result = await providerTravelService.createTravelCharge(
      'org1',
      { shiftId: 's1', km: 5, nonLabourSupportNumber: '01_799_0107_2_1' },
      'admin',
    );
    expect(result).toMatchObject({ alreadyBilled: true, invoiceId: 'inv-existing' });
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  test('requires the matching support item when a dimension is billed', async () => {
    await expect(
      providerTravelService.createTravelCharge(
        'org1',
        { shiftId: 's1', minutes: 30 },
        'admin',
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'MISSING_TRAVEL_SUPPORT_ITEM',
    });
  });

  test('rejects an empty travel charge', async () => {
    await expect(
      providerTravelService.createTravelCharge(
        'org1',
        { shiftId: 's1' },
        'admin',
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'EMPTY_TRAVEL_CHARGE' });
  });

  test('accepts an agreed price below the cap', async () => {
    await providerTravelService.createTravelCharge(
      'org1',
      {
        shiftId: 's1',
        km: 10,
        nonLabourSupportNumber: '01_799_0107_2_1',
        kmUnitPrice: 0.85,
      },
      'admin',
    );
    const payload = mockCreateInvoice.mock.calls[0][0];
    expect(payload.lineItems[0].price).toBe(0.85);
    expect(payload.lineItems[0].totalPrice).toBe(8.5);
  });
});
