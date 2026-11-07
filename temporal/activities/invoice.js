const crypto = require('crypto');
const logger = require('../../config/logger');
const nodemailer = require('nodemailer');
const deliveryLog = require('../../services/invoiceEmailDeliveryLog');

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
 * Stable delivery key for one exact invoice email. Hashing the PDF bytes (not
 * just its length) means two different invoices with the same recipient and
 * subject are never treated as the same delivery.
 */
function invoiceEmailDeliveryKey({ to, subject, fileName, pdfBuffer, deliveryKey }) {
  if (deliveryKey) return String(deliveryKey);
  return crypto
    .createHash('sha256')
    .update(`${to}|${subject}|${fileName || 'invoice.pdf'}|`)
    .update(pdfBuffer)
    .digest('hex');
}

/**
 * Send an invoice PDF via the server-side SMTP account (attachments are
 * NOT supported by the Listmonk transactional path, so invoice mail keeps
 * dedicated SMTP — moved here off the request path with retries).
 *
 * Temporal retries the activity up to five times. A workflow-id reuse policy
 * only collapses duplicate requests; it cannot stop a retry after SMTP already
 * accepted the message. The durable claim plus a deterministic Message-ID make
 * that replay safe.
 */
async function sendInvoiceEmailActivity({
  to,
  subject,
  text,
  pdfBase64,
  fileName,
  deliveryKey,
}) {
  const smtpUser = process.env.SMTP_ADMIN_EMAIL;
  const smtpPass = process.env.SMTP_PASSWORD;
  if (!smtpUser || !smtpPass) {
    throw new Error('Server SMTP is not configured');
  }
  const pdfBuffer = Buffer.from(pdfBase64 || '', 'base64');
  if (pdfBuffer.length === 0) {
    throw new Error('pdfBase64 did not decode to a valid PDF');
  }

  const key = invoiceEmailDeliveryKey({ to, subject, fileName, pdfBuffer, deliveryKey });
  const claim = await deliveryLog.claim(key);
  if (claim.deduped) {
    logger.info('[Temporal] Invoice email already delivered; skipping retry', {
      to,
      deliveryKey: key,
      messageId: claim.messageId,
    });
    return { success: true, duplicate: true, messageId: claim.messageId || null };
  }

  // RFC 5322 Message-ID is stable across retries; mail servers and clients
  // can collapse a duplicate even if the durable claim is unavailable.
  const messageId = `<${key.slice(0, 40)}@invoice.carenest>`;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.smtp2go.com',
    port: Number(process.env.SMTP_PORT || '587'),
    auth: { user: smtpUser, pass: smtpPass },
  });

  let info;
  try {
    info = await transporter.sendMail({
      from: `"CareNest" <${smtpUser}>`,
      to,
      subject,
      text: text || 'Please find the attached invoice.',
      messageId,
      attachments: [
        {
          filename: fileName || 'invoice.pdf',
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });
  } catch (error) {
    // Release the claim so the next Temporal attempt can try again.
    await deliveryLog.release(key);
    throw error;
  }

  const sentMessageId = (info && info.messageId) || messageId;
  await deliveryLog.markSent(key, sentMessageId);
  logger.info('[Temporal] Invoice email sent', { to, messageId: sentMessageId });
  return { success: true, messageId: sentMessageId };
}

module.exports = {
  processInvoiceActivity,
  sendInvoiceEmailActivity
};
