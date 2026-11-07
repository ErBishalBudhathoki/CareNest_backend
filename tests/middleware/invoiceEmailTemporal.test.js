/**
 * Invoice email delivery via Temporal: request returns immediately,
 * SMTP happens in a retried activity, double-taps collapse by workflow ID.
 */
const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: (...args) => mockSendMail(...args) })),
}));

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  security: jest.fn(),
}));

const mockClaim = jest.fn().mockResolvedValue({ deduped: false, durable: true });
const mockMarkSent = jest.fn().mockResolvedValue(undefined);
const mockRelease = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/invoiceEmailDeliveryLog', () => ({
  claim: (...args) => mockClaim(...args),
  markSent: (...args) => mockMarkSent(...args),
  release: (...args) => mockRelease(...args),
}));

const {
  sendInvoiceEmailActivity,
} = require('../../temporal/activities/invoice');
const {
  SendInvoiceEmailWorkflow,
} = require('../../temporal/workflows/invoice');
const workflowIndex = require('../../temporal/workflows/index');

const pdfBase64 = Buffer.from('%PDF-1.4 fake').toString('base64');

describe('sendInvoiceEmailActivity', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClaim.mockResolvedValue({ deduped: false, durable: true });
    mockMarkSent.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);
    process.env.SMTP_ADMIN_EMAIL = 'admin@x.com';
    process.env.SMTP_PASSWORD = 'secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('sends PDF attachment and returns message id', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'mid-1' });
    const result = await sendInvoiceEmailActivity({
      to: 'client@x.com',
      subject: 'Invoice',
      text: 'hi',
      pdfBase64,
      fileName: 'invoice_1.pdf',
    });
    expect(result).toEqual({ success: true, messageId: 'mid-1' });
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('client@x.com');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].contentType).toBe('application/pdf');
  });

  test('rejects empty PDF so Temporal retries instead of sending garbage', async () => {
    await expect(
      sendInvoiceEmailActivity({
        to: 'client@x.com',
        subject: 'Invoice',
        pdfBase64: '',
        fileName: 'invoice.pdf',
      }),
    ).rejects.toThrow('valid PDF');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('fails fast without SMTP config', async () => {
    delete process.env.SMTP_ADMIN_EMAIL;
    await expect(
      sendInvoiceEmailActivity({
        to: 'client@x.com',
        subject: 'Invoice',
        pdfBase64,
        fileName: 'invoice.pdf',
      }),
    ).rejects.toThrow('SMTP is not configured');
  });

  test('sets a deterministic Message-ID and records the delivery', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'mid-2' });
    const params = {
      to: 'client@x.com',
      subject: 'Invoice 42',
      pdfBase64,
      fileName: 'invoice_42.pdf',
    };
    await sendInvoiceEmailActivity(params);
    await sendInvoiceEmailActivity(params);
    const first = mockSendMail.mock.calls[0][0];
    const second = mockSendMail.mock.calls[1][0];
    expect(first.messageId).toMatch(/^<[0-9a-f]{40}@invoice\.carenest>$/);
    expect(second.messageId).toBe(first.messageId);
    expect(mockClaim.mock.calls[0][0]).toBe(mockClaim.mock.calls[1][0]);
    expect(mockMarkSent).toHaveBeenCalledTimes(2);
  });

  test('different PDF bytes produce different delivery keys', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'mid-3' });
    await sendInvoiceEmailActivity({ to: 'c@x.com', subject: 'S', pdfBase64, fileName: 'a.pdf' });
    const otherPdf = Buffer.from('%PDF-1.4 different').toString('base64');
    await sendInvoiceEmailActivity({ to: 'c@x.com', subject: 'S', pdfBase64: otherPdf, fileName: 'a.pdf' });
    expect(mockClaim.mock.calls[0][0]).not.toBe(mockClaim.mock.calls[1][0]);
  });

  test('a durable already-sent claim skips SMTP entirely', async () => {
    mockClaim.mockResolvedValue({ deduped: true, durable: true, messageId: 'mid-original' });
    const result = await sendInvoiceEmailActivity({
      to: 'client@x.com',
      subject: 'Invoice',
      pdfBase64,
      fileName: 'invoice.pdf',
    });
    expect(result).toEqual({ success: true, duplicate: true, messageId: 'mid-original' });
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockMarkSent).not.toHaveBeenCalled();
  });

  test('a failed SMTP send releases the claim so Temporal can retry', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP down'));
    await expect(
      sendInvoiceEmailActivity({
        to: 'client@x.com',
        subject: 'Invoice',
        pdfBase64,
        fileName: 'invoice.pdf',
      }),
    ).rejects.toThrow('SMTP down');
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockMarkSent).not.toHaveBeenCalled();
  });

  test('honours an explicit deliveryKey from the workflow caller', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'mid-4' });
    await sendInvoiceEmailActivity({
      to: 'client@x.com',
      subject: 'Invoice',
      pdfBase64,
      fileName: 'invoice.pdf',
      deliveryKey: 'explicit-stable-key',
    });
    expect(mockClaim.mock.calls[0][0]).toBe('explicit-stable-key');
  });
});

describe('SendInvoiceEmailWorkflow registration', () => {
  test('workflow is exported for the worker bundle', () => {
    expect(typeof SendInvoiceEmailWorkflow).toBe('function');
    expect(workflowIndex.SendInvoiceEmailWorkflow).toBe(
      SendInvoiceEmailWorkflow,
    );
  });
});
