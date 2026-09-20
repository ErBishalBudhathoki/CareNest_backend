/**
 * bulkInvoiceService parity: extracted core must behave exactly like the
 * legacy inline controller logic (grouped + individual + empty cases).
 */
const mockFind = jest.fn();
const mockUpdateMany = jest.fn();
jest.mock('../../models/ClientAssignment', () => ({
  find: (...args) => mockFind(...args),
  updateMany: (...args) => mockUpdateMany(...args),
}));

const mockInvoiceInsertMany = jest.fn();
const MockInvoice = jest.fn().mockImplementation((doc) => ({
  ...doc,
  _id: `inv-${Math.random().toString(36).slice(2)}`,
}));
MockInvoice.insertMany = mockInvoiceInsertMany;
jest.mock('../../models/Invoice', () => MockInvoice);

const mockLineInsertMany = jest.fn();
const MockLineItem = jest.fn().mockImplementation((doc) => ({ ...doc }));
MockLineItem.insertMany = mockLineInsertMany;
jest.mock('../../models/InvoiceLineItem', () => MockLineItem);

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
  mockInvoiceInsertMany.mockResolvedValue([]);
  mockLineInsertMany.mockResolvedValue([]);
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
      totalAmount: expect.closeTo(660, 5),
    });
    expect(MockInvoice).toHaveBeenCalledTimes(2);
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
    expect(summary.totalAmount).toBeCloseTo(440, 5);
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
    expect(mockInvoiceInsertMany).not.toHaveBeenCalled();
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
