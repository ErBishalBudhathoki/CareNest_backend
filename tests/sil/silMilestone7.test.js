/**
 * Milestone 7.1 & 7.3 Integration Unit Tests
 * - SIL Invoice Idempotency Key Replay & Concurrent Race Recovery
 * - Plan Manager Recipient Resolution & Automated Dispatch Workflow
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
  Invoice: {
    findOne: (...args) => mockInvoiceFindOne(...args),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
}));

const mockStakeholderFindOne = jest.fn();
jest.mock('../../models/Stakeholder', () => ({
  findOne: (...args) => mockStakeholderFindOne(...args),
}));

const mockCreateInvoice = jest.fn();
jest.mock('../../services/invoiceManagementService', () => ({
  InvoiceManagementService: {
    generateInvoiceNumber: jest.fn().mockResolvedValue('INV-2026-0007'),
    createInvoice: (...args) => mockCreateInvoice(...args),
  },
}));

const mockEmailSend = jest.fn().mockResolvedValue(true);
jest.mock('../../services/emailService', () => ({
  sendEmail: (...args) => mockEmailSend(...args),
}));

const silBillingService = require('../../services/silBillingService');
const billingRoutingService = require('../../services/billingRoutingService');

describe('Milestone 7: SIL Invoicing Idempotency & Automated Dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('M7.1: Idempotency Key Handling', () => {
    it('returns existing invoice on idempotent replay without re-creating invoice', async () => {
      const mockExisting = {
        _id: 'inv_12345',
        invoiceNumber: 'INV-2026-0001',
        billing: { fundingType: 'plan_managed', recipientType: 'plan_manager' },
        metadata: { idempotencyKey: 'idemp-token-abc' },
      };

      // Mock Invoice.findOne to return existing document when matching idempotencyKey
      mockInvoiceFindOne.mockReturnValueOnce(mockExisting);

      const result = await silBillingService.generateInvoiceFromRosterOfCare(
        'org_test',
        'roc_123',
        {
          from: '2026-04-01',
          to: '2026-04-07',
          idempotencyKey: 'idemp-token-abc',
        },
        'tester'
      );

      expect(result.isIdempotentReplay).toBe(true);
      expect(result.invoice._id).toBe('inv_12345');
      expect(mockCreateInvoice).not.toHaveBeenCalled();
    });

    it('recovers gracefully from MongoDB E11000 duplicate race on concurrent creation', async () => {
      // 1. Idempotency check returns null
      // 2. Period check returns query that resolves to null
      mockInvoiceFindOne
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({ select: () => ({ lean: async () => null }) });

      mockRocFindOne.mockResolvedValue({
        _id: 'roc_123',
        clientId: 'client_789',
        status: 'active',
        supports: [
          { supportNumber: '01_011_0107_1_1', unitPrice: 65.47, hoursPerWeek: 10, shiftType: 'day' },
        ],
      });

      mockClientFindOne.mockReturnValue({
        lean: async () => ({
          _id: 'client_789',
          clientFirstName: 'Jane',
          clientLastName: 'Doe',
          fundingType: 'plan_managed',
        }),
      });

      // Simulate concurrent E11000 duplicate key exception from createInvoice
      const duplicateErr = new Error('E11000 duplicate key error collection: invoices index: sil_roc_period_unique');
      duplicateErr.code = 11000;
      mockCreateInvoice.mockRejectedValueOnce(duplicateErr);

      // 3. Race recovery findOne returns the winning invoice
      const winningInvoice = {
        _id: 'inv_winner_999',
        invoiceNumber: 'INV-2026-0002',
        billing: { fundingType: 'plan_managed' },
      };
      mockInvoiceFindOne.mockReturnValueOnce(winningInvoice);

      const result = await silBillingService.generateInvoiceFromRosterOfCare(
        'org_test',
        'roc_123',
        {
          from: '2026-04-01',
          to: '2026-04-07',
          idempotencyKey: 'race-key-001',
        },
        'tester'
      );

      expect(result.isIdempotentReplay).toBe(true);
      expect(result.invoice._id).toBe('inv_winner_999');
    });
  });

  describe('M7.3: Plan Manager Recipient Resolution & Automated Dispatch Workflow', () => {
    it('resolves primary plan manager stakeholder contact details', async () => {
      const client = {
        _id: 'client_pm_1',
        organizationId: 'org_test',
        fundingType: 'plan_managed',
        clientFirstName: 'Alice',
        clientLastName: 'Smith',
        clientEmail: 'alice@example.com',
        stakeholders: [
          { role: 'plan_manager', stakeholderId: 'sh_pm_99' },
          { role: 'family', stakeholderId: 'sh_fam_11' },
        ],
      };

      mockStakeholderFindOne.mockReturnValue({
        lean: async () => ({
          _id: 'sh_pm_99',
          name: 'MyPlan Manager Pty Ltd',
          email: 'accounts@myplan.com.au',
          company: 'MyPlan Manager',
          phone: '1300 123 456',
        }),
      });

      const recipient = await billingRoutingService.resolveBillingRecipient(client);
      expect(recipient.type).toBe('plan_manager');
      expect(recipient.name).toBe('MyPlan Manager Pty Ltd');
      expect(recipient.email).toBe('accounts@myplan.com.au');
      expect(recipient.company).toBe('MyPlan Manager');
    });

    it('dispatches invoice to plan manager, updates workflow status to sent, and sends email', async () => {
      const mockSave = jest.fn().mockResolvedValue(true);
      const invoiceDoc = {
        _id: 'inv_to_dispatch',
        invoiceNumber: 'INV-2026-0007',
        clientId: 'client_pm_1',
        clientName: 'Alice Smith',
        financialSummary: { totalAmount: 654.70 },
        metadata: { silPeriod: { from: new Date('2026-04-01'), to: new Date('2026-04-07') } },
        billing: {
          recipientDetails: {
            type: 'plan_manager',
            name: 'MyPlan Manager Pty Ltd',
            email: 'accounts@myplan.com.au',
          },
        },
        workflow: { status: 'generated', currentStep: 'generated', nextAction: 'send' },
        auditTrail: { changeHistory: [] },
        save: mockSave,
      };

      mockInvoiceFindOne.mockReturnValueOnce(invoiceDoc);
      mockClientFindOne.mockReturnValue({ lean: async () => ({ _id: 'client_pm_1' }) });

      const dispatchResult = await silBillingService.dispatchInvoice('org_test', 'inv_to_dispatch', {
        actor: 'billing_admin',
        dispatchMethod: 'email',
      });

      expect(dispatchResult.success).toBe(true);
      expect(dispatchResult.data.status).toBe('sent');
      expect(dispatchResult.data.recipientEmail).toBe('accounts@myplan.com.au');
      expect(dispatchResult.data.emailSent).toBe(true);
      expect(mockEmailSend).toHaveBeenCalledWith(
        'accounts@myplan.com.au',
        expect.stringContaining('INV-2026-0007'),
        expect.stringContaining('$654.70')
      );
      expect(mockSave).toHaveBeenCalled();
      expect(invoiceDoc.workflow.status).toBe('sent');
      expect(invoiceDoc.billing.recipientDetails.dispatchedBy).toBe('billing_admin');
    });
  });
});
