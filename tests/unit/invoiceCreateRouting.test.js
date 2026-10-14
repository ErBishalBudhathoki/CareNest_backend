/**
 * Invoice creation routing (Phase 6): the create-invoice endpoint must honour
 * the funding route stamped on the invoice.
 *
 *   - claim_csv   → NO Stripe payment link (settled by NDIA Bulk Payment Request)
 *   - plan_managed→ a payment link is fine, and the plan-manager recipient is
 *                   resolved and recorded on the stored header
 *   - self_managed→ participant payment link, no recipient swap
 *
 * Dependencies are mocked; the endpoint handler is exercised directly.
 */

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  security: jest.fn(),
  business: jest.fn(),
  debug: jest.fn(),
}));

const mockCreateInvoice = jest.fn();
const mockGenerateInvoiceNumber = jest.fn();
const mockAttachPdfArtifact = jest.fn();
jest.mock('../../services/invoiceManagementService', () => ({
  InvoiceManagementService: {
    createInvoice: (...args) => mockCreateInvoice(...args),
    generateInvoiceNumber: (...args) => mockGenerateInvoiceNumber(...args),
    attachPdfArtifact: (...args) => mockAttachPdfArtifact(...args),
  },
}));

jest.mock('../../services/invoiceArtifactService', () => ({
  invoiceArtifactService: { uploadPdfBase64: jest.fn() },
}));

const mockCreatePaymentLink = jest.fn();
jest.mock('../../services/billing/stripePaymentLinkService', () => ({
  createInvoicePaymentLink: (...args) => mockCreatePaymentLink(...args),
}));

const mockInvoiceUpdateOne = jest.fn();
jest.mock('../../models/Invoice', () => ({
  Invoice: { updateOne: (...args) => mockInvoiceUpdateOne(...args) },
}));

const mockStakeholderFindOne = jest.fn();
jest.mock('../../models/Stakeholder', () => ({
  findOne: (...args) => mockStakeholderFindOne(...args),
}));

const { createInvoice } = require('../../endpoints/invoice_management_endpoints');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function baseBody(overrides = {}) {
  return {
    organizationId: 'org1',
    clientId: 'c1',
    clientEmail: 'ada@example.com',
    clientName: 'Ada Nguyen',
    invoiceType: 'client',
    invoiceNumber: 'INV-1',
    issuer: {
      businessName: 'Care Co',
      businessAddress: '1 Main St',
      contactEmail: 'hello@care.co',
      contactPhone: '0400000000',
    },
    billedTo: { name: 'Ada Nguyen', email: 'ada@example.com' },
    lineItems: [
      {
        supportItemNumber: '01_011_0107_1_1',
        supportItemName: 'Daily living',
        quantity: 1,
        price: 100,
        totalPrice: 100,
      },
    ],
    financialSummary: { subtotal: 100, totalAmount: 100 },
    ...overrides,
  };
}

function armCreatedInvoice(billing) {
  mockCreateInvoice.mockResolvedValue({
    success: true,
    data: {
      _id: 'inv1',
      invoiceNumber: 'INV-1',
      financialSummary: { totalAmount: 100 },
      workflow: { status: 'generated' },
      auditTrail: { createdAt: new Date() },
      header: { billedTo: { name: 'Ada Nguyen', email: 'ada@example.com' } },
      billing,
    },
  });
}

const run = async (body) => {
  const req = { body, headers: {} };
  const res = mockRes();
  await createInvoice(req, res);
  return res;
};

describe('createInvoice — funding/billing routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoiceUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    mockCreatePaymentLink.mockResolvedValue({ url: 'https://pay.example/inv1' });
  });

  test('NDIA claim invoice: no Stripe payment link is created', async () => {
    armCreatedInvoice({ fundingType: 'ndia_managed', recipientType: 'ndia', artifact: 'claim_csv' });

    const res = await run(baseBody());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCreatePaymentLink).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.billing).toMatchObject({ artifact: 'claim_csv' });
    expect(payload.data.paymentLinkReason).toBe('ndia_claim');
    expect(payload.data.paymentLinkUrl).toBeNull();
  });

  test('plan-managed invoice: link created and recipient resolved onto the header', async () => {
    armCreatedInvoice({
      fundingType: 'plan_managed',
      recipientType: 'plan_manager',
      artifact: 'invoice_pdf',
      planManagerStakeholderId: 'pm1',
    });
    mockStakeholderFindOne.mockReturnValue({
      select: () => ({
        lean: async () => ({ name: 'Riverbend PM', email: 'invoices@riverbend.example', company: 'Riverbend Plan Management' }),
      }),
    });

    const res = await run(baseBody());

    expect(mockCreatePaymentLink).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.billingRecipient).toMatchObject({
      type: 'plan_manager',
      name: 'Riverbend PM',
      email: 'invoices@riverbend.example',
    });
    expect(mockInvoiceUpdateOne).toHaveBeenCalledWith(
      { _id: 'inv1', organizationId: 'org1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          'header.billedTo': expect.objectContaining({
            recipientType: 'plan_manager',
            name: 'Riverbend PM',
            email: 'invoices@riverbend.example',
          }),
        }),
      }),
    );
  });

  test('self-managed invoice: participant link, no recipient swap', async () => {
    armCreatedInvoice({
      fundingType: 'self_managed',
      recipientType: 'participant',
      artifact: 'invoice_pdf',
    });

    const res = await run(baseBody());

    expect(mockCreatePaymentLink).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.billingRecipient).toBeNull();
    expect(mockInvoiceUpdateOne).not.toHaveBeenCalled();
  });

  test('employee invoice: no client payment link', async () => {
    armCreatedInvoice(null);

    const res = await run(baseBody({ invoiceType: 'employee' }));

    expect(mockCreatePaymentLink).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.paymentLinkReason).toBe('not_a_client_invoice');
  });
});
