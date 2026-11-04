/**
 * Milestone 3.4: `invoiceManagementService.createInvoice` stamps `fundingRoute`
 * on every line item before the invoice is persisted, so the NDIA claim batch
 * (ndisClaimService) can split Core/SIL lines (ndia_managed) from
 * plan/self-managed lines for combination-funded participants.
 *
 * The stamping is best-effort: a routing failure must never block invoice
 * creation.
 */
jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
}));

const mockValidatePlan = jest.fn();
jest.mock('../../services/planBudgetService', () => ({
  validateInvoiceAgainstPlan: (...args) => mockValidatePlan(...args),
}));

const mockValidatePrice = jest.fn();
jest.mock('../../services/priceValidationService', () => ({
  priceValidationService: { validatePrice: (...args) => mockValidatePrice(...args) },
}));

const mockClientFindOne = jest.fn();
jest.mock('../../models/Client', () => ({
  findOne: (...args) => mockClientFindOne(...args),
}));

jest.mock('../../models/Invoice', () => {
  class MockInvoice {
    constructor(doc) {
      Object.assign(this, doc);
    }

    async save() {
      return { ...this, _id: 'inv-stamp-1' };
    }
  }
  return {
    Invoice: MockInvoice,
    InvoiceStatus: {},
    PaymentStatus: {},
  };
});

const mockLineInsertMany = jest.fn();
jest.mock('../../models/InvoiceLineItem', () => ({
  insertMany: (...args) => mockLineInsertMany(...args),
}));

const {
  InvoiceManagementService,
} = require('../../services/invoiceManagementService');
const billingRoutingService = require('../../services/billingRoutingService');
const logger = require('../../config/logger');

const baseInput = () => ({
  organizationId: 'org1',
  clientId: 'client1',
  clientEmail: 'combo@example.com',
  clientName: 'Combo Participant',
  invoiceType: 'client',
  invoiceNumber: 'INV-STAMP-1',
  issueDate: new Date('2026-11-01T00:00:00Z'),
  dueDate: new Date('2026-12-01T00:00:00Z'),
  status: 'pending',
  // Explicit per-item caps so the NDIA price-cap gate does not need the
  // price catalogue; the routing logic under test is independent of caps.
  lineItems: [
    { supportItemNumber: '01_011_0107_1_1', quantity: 2, price: 65.47, totalPrice: 130.94, priceCap: 100, date: new Date('2026-10-01') },
    { supportItemNumber: '07_001_0107_1_1', quantity: 1, price: 80, totalPrice: 80, priceCap: 100, date: new Date('2026-10-01') },
    { supportItemNumber: '03_131_0104_3_1', quantity: 1, price: 50, totalPrice: 50, priceCap: 100, date: new Date('2026-10-01') },
  ],
  financialSummary: { subtotal: 260.94, taxAmount: 0, totalAmount: 260.94, currency: 'AUD' },
  metadata: { silPeriod: { from: '2026-10-01', to: '2026-10-31' } },
});

const combinationClient = (categories = []) => ({
  _id: 'client1',
  fundingType: 'combination',
  clientState: 'NSW',
  plan: {
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-12-31T00:00:00Z'),
    totalBudget: 100000,
    categories,
    status: 'active',
  },
});

function armPlanGate(client) {
  mockValidatePlan.mockResolvedValue({ ok: true, overridden: false, skipped: false });
  mockClientFindOne.mockReturnValue({
    select: () => ({ lean: async () => client }),
  });
  mockLineInsertMany.mockResolvedValue([]);
  mockValidatePrice.mockResolvedValue({ isValid: true, status: 'valid', priceCap: 100 });
}

const stampedRoutes = () =>
  mockLineInsertMany.mock.calls[0][0].map((item) => item.fundingRoute);

describe('createInvoice — line-item fundingRoute stamping (M3.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('combination participant: routes split by NDIS category', async () => {
    armPlanGate(combinationClient());

    const result = await InvoiceManagementService.createInvoice(baseInput());

    expect(result.success).toBe(true);
    expect(mockClientFindOne).toHaveBeenCalledWith({ _id: 'client1', organizationId: 'org1' });
    expect(stampedRoutes()).toEqual(['ndia_managed', 'plan_managed', 'self_managed']);
    expect(result.data.lineItems.map((i) => i.fundingRoute)).toEqual([
      'ndia_managed',
      'plan_managed',
      'self_managed',
    ]);
  });

  test('explicit per-category fundingType overrides the default NDIS routing', async () => {
    armPlanGate(
      combinationClient([
        { categoryNumber: '01', name: 'Core Supports', budget: 40000, fundingType: 'self_managed' },
      ])
    );

    const result = await InvoiceManagementService.createInvoice(baseInput());

    expect(result.success).toBe(true);
    expect(stampedRoutes()).toEqual(['self_managed', 'plan_managed', 'self_managed']);
  });

  test('ndia_managed participant: all lines stamped ndia_managed', async () => {
    armPlanGate({ ...combinationClient(), fundingType: 'ndia_managed' });

    const result = await InvoiceManagementService.createInvoice(baseInput());

    expect(result.success).toBe(true);
    expect(stampedRoutes()).toEqual(['ndia_managed', 'ndia_managed', 'ndia_managed']);
  });

  test('plan_managed participant: all lines stamped plan_managed', async () => {
    armPlanGate({ ...combinationClient(), fundingType: 'plan_managed' });

    const result = await InvoiceManagementService.createInvoice(baseInput());

    expect(result.success).toBe(true);
    expect(stampedRoutes()).toEqual(['plan_managed', 'plan_managed', 'plan_managed']);
  });

  test('self_managed participant: all lines stamped self_managed', async () => {
    armPlanGate({ ...combinationClient(), fundingType: 'self_managed' });

    const result = await InvoiceManagementService.createInvoice(baseInput());

    expect(result.success).toBe(true);
    expect(stampedRoutes()).toEqual(['self_managed', 'self_managed', 'self_managed']);
  });

  test('a routing failure never blocks invoice creation', async () => {
    armPlanGate(combinationClient());
    jest.spyOn(billingRoutingService, 'resolveLineItemRoute').mockImplementation(() => {
      throw new Error('routing exploded');
    });

    const result = await InvoiceManagementService.createInvoice(baseInput());

    expect(result.success).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to stamp line-item funding routes',
      expect.objectContaining({ error: 'routing exploded' })
    );
  });

  test('invoice without clientId skips the participant lookup and stamping', async () => {
    armPlanGate(null);
    mockClientFindOne.mockReset();
    const input = baseInput();
    delete input.clientId;

    const result = await InvoiceManagementService.createInvoice(input);

    expect(result.success).toBe(true);
    expect(mockClientFindOne).not.toHaveBeenCalled();
    expect(stampedRoutes()).toEqual([undefined, undefined, undefined]);
  });
});
