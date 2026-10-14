/**
 * SIL → billing wiring (Phase 4 → Phase 6): an active roster-of-care is
 * prorated over a period into a client invoice, inheriting the participant's
 * funding route. Models and the invoice service are mocked.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

const mockRocFindOne = jest.fn();
jest.mock('../../models/SILRosterOfCare', () => ({
  findOne: (...args) => mockRocFindOne(...args),
}));

const mockClientFindOne = jest.fn();
jest.mock('../../models/Client', () => ({
  findOne: (...args) => mockClientFindOne(...args),
}));

const mockInvoiceFindOne = jest.fn();
jest.mock('../../models/Invoice', () => ({
  Invoice: { findOne: (...args) => mockInvoiceFindOne(...args) },
}));

const mockGenerateInvoiceNumber = jest.fn();
const mockCreateInvoice = jest.fn();
// Mirror the real module shape: it exports the instance under
// `InvoiceManagementService`, not the methods directly.
jest.mock('../../services/invoiceManagementService', () => ({
  InvoiceManagementService: {
    generateInvoiceNumber: (...args) => mockGenerateInvoiceNumber(...args),
    createInvoice: (...args) => mockCreateInvoice(...args),
  },
}));

const silBillingService = require('../../services/silBillingService');

const noExistingInvoice = () =>
  mockInvoiceFindOne.mockReturnValue({ select: () => ({ lean: async () => null }) });

const activeRoc = {
  _id: 'roc1',
  clientId: 'c1',
  status: 'active',
  supports: [
    { supportNumber: '01_011_0107_1_1', supportName: 'Daily living', hoursPerWeek: 10, unitPrice: 70 },
    { supportNumber: '01_015_0107_1_1', supportName: 'Community', hoursPerWeek: 5, unitPrice: 60 },
  ],
};

describe('SILBillingService.generateInvoiceFromRosterOfCare', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRocFindOne.mockResolvedValue(activeRoc);
    mockClientFindOne.mockReturnValue({
      lean: async () => ({
        clientFirstName: 'Ada',
        clientLastName: 'Nguyen',
        clientEmail: 'ada@example.com',
      }),
    });
    noExistingInvoice();
    mockGenerateInvoiceNumber.mockResolvedValue('INVORG6101AN');
    mockCreateInvoice.mockImplementation(async (data) => ({
      success: true,
      data: {
        ...data,
        _id: 'inv1',
        billing: { fundingType: 'ndia_managed', recipientType: 'ndia', artifact: 'claim_csv' },
      },
    }));
  });

  test('prorates weekly supports over the period into invoice line items', async () => {
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14' },
      'admin@org.com',
    );

    // 14 inclusive days = 2 weeks.
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    const payload = mockCreateInvoice.mock.calls[0][0];
    expect(payload.lineItems).toHaveLength(2);
    expect(payload.lineItems[0]).toMatchObject({
      supportItemNumber: '01_011_0107_1_1',
      quantity: 20, // 10h/wk × 2 weeks
      price: 70,
      unit: 'H',
      totalPrice: 1400,
    });
    expect(payload.lineItems[1]).toMatchObject({ quantity: 10, totalPrice: 600 });
    // NDIS supports are GST-free.
    expect(payload.financialSummary).toMatchObject({ subtotal: 2000, taxAmount: 0, totalAmount: 2000 });
    expect(payload.metadata).toMatchObject({
      invoiceType: 'client',
      generationMethod: 'sil_roster_of_care',
    });
    // Addressed to the participant using the canonical Client name fields.
    expect(payload.clientName).toBe('Ada Nguyen');
    expect(payload.clientEmail).toBe('ada@example.com');
  });

  test('surfaces the funding route stamped on the created invoice', async () => {
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14' },
    );

    expect(result.billing).toMatchObject({ fundingType: 'ndia_managed', artifact: 'claim_csv' });
  });

  test('is idempotent — refuses to re-bill the same RoC for the same period', async () => {
    mockInvoiceFindOne.mockReturnValue({
      select: () => ({ lean: async () => ({ _id: 'inv-existing', invoiceNumber: 'INV-1' }) }),
    });

    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14' },
    );

    expect(result.conflict).toBe(true);
    expect(result.existingInvoiceId).toBe('inv-existing');
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  test('rejects a roster of care that is not active', async () => {
    mockRocFindOne.mockResolvedValue({ ...activeRoc, status: 'ended' });
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14' },
    );
    expect(result.invalidState).toBe(true);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  test('rejects an invalid period', async () => {
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-14', to: '2026-04-01' },
    );
    expect(result.invalidPeriod).toBe(true);
  });

  test('returns notFound for an unknown roster of care', async () => {
    mockRocFindOne.mockResolvedValue(null);
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'missing',
      { from: '2026-04-01', to: '2026-04-14' },
    );
    expect(result.notFound).toBe(true);
  });

  test('rejects a period with no billable supports', async () => {
    mockRocFindOne.mockResolvedValue({
      ...activeRoc,
      supports: [{ supportNumber: 'x', hoursPerWeek: 0, unitPrice: 70 }],
    });
    const result = await silBillingService.generateInvoiceFromRosterOfCare(
      'org1',
      'roc1',
      { from: '2026-04-01', to: '2026-04-14' },
    );
    expect(result.invalidState).toBe(true);
  });
});

describe('SILBillingService.inclusiveDays', () => {
  test('counts both endpoints', () => {
    expect(
      silBillingService.inclusiveDays(new Date('2026-04-01'), new Date('2026-04-01')),
    ).toBe(1);
    expect(
      silBillingService.inclusiveDays(new Date('2026-04-01'), new Date('2026-04-14')),
    ).toBe(14);
  });
});
