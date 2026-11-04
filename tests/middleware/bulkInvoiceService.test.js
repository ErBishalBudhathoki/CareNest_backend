/**
 * bulkInvoiceService → unified invoice pipeline (Milestone 1.1 / Gap 2).
 * Bulk generation routes every invoice through
 * `invoiceManagementService.createInvoice`, so plan-budget gating, price-cap
 * validation and fundingRoute stamping apply to bulk invoices too.
 */
const mockFind = jest.fn();
const mockUpdateMany = jest.fn();
jest.mock('../../models/ClientAssignment', () => ({
  find: (...args) => mockFind(...args),
  updateMany: (...args) => mockUpdateMany(...args),
}));

const mockCreateInvoice = jest.fn();
jest.mock('../../services/invoiceManagementService', () => ({
  InvoiceManagementService: {
    createInvoice: (...args) => mockCreateInvoice(...args),
  },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
}));

const {
  generateInvoicesFromAppointments,
  bulkInvoicesWorkflowId,
  NoEligibleAppointmentsError,
} = require('../../services/bulkInvoiceService');

const apt = (id, clientId) => ({
  _id: id,
  clientId: { _id: clientId, firstName: 'A', lastName: 'B', email: 'c@x.com' },
  serviceId: { name: 'Support', rate: 100 },
  duration: 2,
  date: new Date('2026-09-01T00:00:00Z'),
});

function armAppointments(list) {
  mockFind.mockReturnValue({
    populate: jest.fn(() => ({
      populate: jest.fn().mockResolvedValue(list),
    })),
  });
  mockCreateInvoice.mockImplementation(async (invoiceData) => ({
    success: true,
    data: { _id: `inv-${invoiceData.invoiceNumber}`, total: invoiceData.total },
  }));
  mockUpdateMany.mockResolvedValue({ modifiedCount: list.length });
}

describe('generateInvoicesFromAppointments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('groups by client when requested', async () => {
    armAppointments([apt('a1', 'c1'), apt('a2', 'c1'), apt('a3', 'c2')]);
    const summary = await generateInvoicesFromAppointments({
      appointmentIds: ['a1', 'a2', 'a3'],
      organizationId: 'org-a',
      groupByClient: true,
    });
    expect(summary).toEqual({
      invoiceCount: 2,
      appointmentCount: 3,
      totalAmount: expect.closeTo(600, 5),
    });
    expect(mockCreateInvoice).toHaveBeenCalledTimes(2);
    const payloads = mockCreateInvoice.mock.calls.map((call) => call[0]);
    payloads.forEach((payload) => {
      expect(payload.financialSummary.taxAmount).toBe(0);
      expect(payload.tax).toBe(0);
      expect(payload.total).toBe(payload.subtotal);
      expect(payload.financialSummary.totalAmount).toBe(payload.subtotal);
      expect(Array.isArray(payload.lineItems)).toBe(true);
      expect(payload.lineItems.length).toBeGreaterThan(0);
    });
    const c1Payload = payloads.find((p) => p.clientId === 'c1');
    const c2Payload = payloads.find((p) => p.clientId === 'c2');
    expect(c1Payload.lineItems).toHaveLength(2);
    expect(c2Payload.lineItems).toHaveLength(1);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      { _id: { $in: ['a1', 'a2', 'a3'] } },
      { $set: { invoiced: true } },
    );
  });

  test('creates individual invoices otherwise', async () => {
    armAppointments([apt('a1', 'c1'), apt('a2', 'c2')]);
    const summary = await generateInvoicesFromAppointments({
      appointmentIds: ['a1', 'a2'],
      organizationId: 'org-a',
      groupByClient: false,
    });
    expect(summary.invoiceCount).toBe(2);
    expect(summary.totalAmount).toBeCloseTo(400, 5);
    expect(mockCreateInvoice).toHaveBeenCalledTimes(2);
    const payloads = mockCreateInvoice.mock.calls.map((call) => call[0]);
    payloads.forEach((payload) => {
      expect(payload.financialSummary.taxAmount).toBe(0);
      expect(payload.tax).toBe(0);
      expect(payload.total).toBe(payload.subtotal);
      expect(payload.financialSummary.totalAmount).toBe(payload.subtotal);
      expect(payload.lineItems).toHaveLength(1);
    });
  });

  test('throws 404 error when nothing is eligible', async () => {
    armAppointments([]);
    await expect(
      generateInvoicesFromAppointments({
        appointmentIds: ['nope'],
        organizationId: 'org-a',
      }),
    ).rejects.toBeInstanceOf(NoEligibleAppointmentsError);
    await expect(
      generateInvoicesFromAppointments({
        appointmentIds: ['nope'],
        organizationId: 'org-a',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  test('fails closed when the unified pipeline rejects an invoice', async () => {
    armAppointments([apt('a1', 'c1')]);
    mockCreateInvoice.mockResolvedValue({
      success: false,
      error: 'One or more line items exceed the NDIS price cap.',
    });
    await expect(
      generateInvoicesFromAppointments({
        appointmentIds: ['a1'],
        organizationId: 'org-a',
        groupByClient: false,
      }),
    ).rejects.toThrow('exceed the NDIS price cap');
    // Appointments must not be marked invoiced when the pipeline fails.
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

describe('bulkInvoicesWorkflowId', () => {
  test('is deterministic and order-independent per org', () => {
    const a = bulkInvoicesWorkflowId('org-a', ['x', 'y', 'z']);
    const b = bulkInvoicesWorkflowId('org-a', ['z', 'x', 'y']);
    const c = bulkInvoicesWorkflowId('org-b', ['x', 'y', 'z']);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^bulk-invoices-org-a-[0-9a-f]{16}$/);
  });
});
