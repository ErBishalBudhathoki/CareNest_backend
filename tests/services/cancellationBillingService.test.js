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

const cancellationBillingService = require('../../services/cancellationBillingService');

function shift(overrides = {}) {
  return {
    _id: 's1',
    organizationId: 'org1',
    clientId: 'c1',
    status: 'approved',
    startTime: new Date('2026-06-10T09:00:00+10:00'),
    endTime: new Date('2026-06-10T11:00:00+10:00'),
    breakDuration: 0,
    shiftType: 'day',
    isActive: true,
    supportItems: [{ itemNumber: '01_011_0107_1_1', itemName: 'Daily living' }],
    cancellation: {},
    save: jest.fn(),
    ...overrides,
  };
}

describe('CancellationBillingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClientFindOne.mockReturnValue({
      lean: async () => ({
        clientFirstName: 'Ada',
        clientLastName: 'Nguyen',
        clientEmail: 'ada@example.com',
        clientState: 'NSW',
        fundingType: 'ndia_managed',
      }),
    });
    mockGenerateInvoiceNumber.mockResolvedValue('INV-CAN-1');
    mockCreateInvoice.mockImplementation(async (data) => ({
      success: true,
      data: { ...data, _id: 'inv1' },
    }));
    mockValidatePrice.mockResolvedValue({ priceCap: 70 });
  });

  test('invoices a short-notice cancellation at the price cap', async () => {
    const s = shift();
    mockShiftFindOne.mockResolvedValue(s);

    const result = await cancellationBillingService.createCancellationCharge(
      'org1',
      {
        shiftId: 's1',
        reason: 'NSCC',
        cancelledAt: '2026-06-09T09:00:00+10:00', // 24h notice
      },
      'admin',
    );

    expect(result.billable).toBe(true);
    expect(result.amount).toBe(140); // 2h × $70
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const payload = mockCreateInvoice.mock.calls[0][0];
    expect(payload.lineItems[0]).toMatchObject({
      supportItemNumber: '01_011_0107_1_1',
      claimType: 'CANCELLATION',
      cancellationReason: 'NSCC',
      quantity: 2,
      price: 70,
      totalPrice: 140,
    });
    expect(s.status).toBe('cancelled');
    expect(s.cancellation.billable).toBe(true);
    expect(s.cancellation.invoiceId).toBe('inv1');
    expect(s.save).toHaveBeenCalled();
  });

  test('does not raise a fee outside the short-notice window', async () => {
    const s = shift();
    mockShiftFindOne.mockResolvedValue(s);

    const result = await cancellationBillingService.createCancellationCharge(
      'org1',
      {
        shiftId: 's1',
        reason: 'NSCC',
        cancelledAt: '2026-06-01T09:00:00+10:00', // 9 days
      },
      'admin',
    );

    expect(result.billable).toBe(false);
    expect(result.reason).toBe('NOT_SHORT_NOTICE');
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(s.status).toBe('cancelled');
  });

  test('never bills the same cancellation twice', async () => {
    mockShiftFindOne.mockResolvedValue(
      shift({ cancellation: { invoiceId: 'inv-existing' } }),
    );

    const result = await cancellationBillingService.createCancellationCharge(
      'org1',
      { shiftId: 's1', reason: 'NSCC' },
      'admin',
    );

    expect(result).toMatchObject({
      alreadyBilled: true,
      invoiceId: 'inv-existing',
    });
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  test('bills a sleepover cancellation as one fixed fee', async () => {
    const s = shift({ shiftType: 'sleepover' });
    mockShiftFindOne.mockResolvedValue(s);

    const result = await cancellationBillingService.createCancellationCharge(
      'org1',
      {
        shiftId: 's1',
        reason: 'NSDH',
        cancelledAt: '2026-06-10T08:00:00+10:00',
      },
      'admin',
    );

    expect(result.billable).toBe(true);
    expect(result.amount).toBe(70);
    const payload = mockCreateInvoice.mock.calls[0][0];
    expect(payload.lineItems[0]).toMatchObject({
      quantity: 1,
      unit: 'E',
      totalPrice: 70,
    });
  });

  test('rejects a shift without a support item', async () => {
    mockShiftFindOne.mockResolvedValue(shift({ supportItems: [] }));

    await expect(
      cancellationBillingService.createCancellationCharge(
        'org1',
        {
          shiftId: 's1',
          reason: 'NSCC',
          cancelledAt: '2026-06-09T09:00:00+10:00',
        },
        'admin',
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: 'MISSING_SUPPORT_ITEM' });
  });
});
