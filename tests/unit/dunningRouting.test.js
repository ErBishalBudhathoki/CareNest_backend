/**
 * Dunning must not chase a participant for an NDIA-managed invoice — that work
 * is settled by a Bulk Payment Request. Legacy invoices (no billing block) must
 * still be dun-able.
 */

jest.mock('../../config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  business: jest.fn(),
}));

const mockFind = jest.fn().mockResolvedValue([]);
jest.mock('../../models/Invoice', () => ({
  Invoice: { find: (...args) => mockFind(...args) },
  InvoiceStatus: { SENT: 'sent', OVERDUE: 'overdue' },
  PaymentStatus: { PENDING: 'pending', PARTIAL: 'partial', OVERDUE: 'overdue' },
}));

jest.mock('../../services/emailService', () => ({ sendEmail: jest.fn() }));

const dunningService = require('../../services/dunningService');

describe('DunningService.processOverdueInvoices routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFind.mockResolvedValue([]);
  });

  test('excludes claim (NDIA) invoices from the overdue query', async () => {
    await dunningService.processOverdueInvoices();

    expect(mockFind).toHaveBeenCalledTimes(1);
    const [query] = mockFind.mock.calls[0];
    expect(query['billing.artifact']).toEqual({ $ne: 'claim_csv' });
    // Legacy invoices (no billing block) still match `$ne`, so the rest of the
    // eligibility filter is unchanged.
    expect(query['payment.status']).toEqual({ $in: ['pending', 'partial', 'overdue'] });
  });
});
