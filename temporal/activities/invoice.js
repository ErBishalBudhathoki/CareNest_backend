const logger = require('../../config/logger');
const nodemailer = require('nodemailer');

/**
 * Process Invoice Generation or Pre-calculation.
 * @param {Object} params
 * @param {string} params.shiftId
 * @param {string} params.clientEmail
 * @param {string} params.organizationId
 */
async function processInvoiceActivity({ shiftId, clientEmail, organizationId }) {
  logger.info(`Activity processing invoice generation for shift ${shiftId}`, {
    clientEmail,
    organizationId
  });

  try {
    // Logic to generate invoice or pre-calculate
    // Example: We could generate a draft invoice for this client for the current period
    
    // Invoking the service to ensure connection and basic validation works
    // await invoiceService.connect();
    // ... logic ...
    
    logger.info(`Invoice pre-calculation logic executed for ${shiftId}`);
    
    return { processed: true, shiftId };
  } catch (error) {
    logger.error(`Invoice activity failed for shift ${shiftId}`, error);
    throw error;
  }
}

/**
 * Send an invoice PDF via the server-side SMTP account (attachments are
 * NOT supported by the Listmonk transactional path, so invoice mail keeps
 * dedicated SMTP — moved here off the request path with retries).
 */
async function sendInvoiceEmailActivity({ to, subject, text, pdfBase64, fileName }) {
  const smtpUser = process.env.SMTP_ADMIN_EMAIL;
  const smtpPass = process.env.SMTP_PASSWORD;
  if (!smtpUser || !smtpPass) {
    throw new Error('Server SMTP is not configured');
  }
  const pdfBuffer = Buffer.from(pdfBase64 || '', 'base64');
  if (pdfBuffer.length === 0) {
    throw new Error('pdfBase64 did not decode to a valid PDF');
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.smtp2go.com',
    port: Number(process.env.SMTP_PORT || '587'),
    auth: { user: smtpUser, pass: smtpPass },
  });
  const info = await transporter.sendMail({
    from: `"CareNest" <${smtpUser}>`,
    to,
    subject,
    text: text || 'Please find the attached invoice.',
    attachments: [
      {
        filename: fileName || 'invoice.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
  logger.info('[Temporal] Invoice email sent', { to, messageId: info && info.messageId });
  return { success: true, messageId: (info && info.messageId) || null };
}

module.exports = {
  processInvoiceActivity,
  sendInvoiceEmailActivity
};
