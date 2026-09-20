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
});

describe('SendInvoiceEmailWorkflow registration', () => {
  test('workflow is exported for the worker bundle', () => {
    expect(typeof SendInvoiceEmailWorkflow).toBe('function');
    expect(workflowIndex.SendInvoiceEmailWorkflow).toBe(
      SendInvoiceEmailWorkflow,
    );
  });
});
