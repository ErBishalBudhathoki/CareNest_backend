'use strict';

/**
 * ListmonkService
 *
 * Drop-in replacement for the old nodemailer-based emailService.
 * All callers use the same interface:
 *   emailService.sendEmail(to, subject, html, attachments?)
 *   emailService.getReceiptTemplate(...)
 *   emailService.getRefundTemplate(...)
 *
 * Additionally exposes auth-specific methods for transactional emails.
 *
 * Transport Strategy:
 *   - Transactional emails  → POST /api/tx  (uses Listmonk template ID 1 as base)
 *     We pass the full HTML as the "body" override so we don't need a separate
 *     template per email type — Listmonk renders whatever HTML we send.
 *   - Subscriber sign-ups   → POST /api/subscribers  (adds to list ID 3)
 */

const https = require('https');
const logger = require('../config/logger');

const LISTMONK_BASE_URL    = process.env.LISTMONK_BASE_URL    || 'https://listmonk.bishalbudhathoki.com/api';
const LISTMONK_API_KEY     = process.env.listmonk_api_key;
const LISTMONK_USERNAME    = process.env.LISTMONK_USERNAME    || 'carenest';
const ONBOARDING_LIST_ID   = parseInt(process.env.LISTMONK_ONBOARDING_LIST_ID || '3', 10);

// Build Authorization header.
function authHeader() {
  if (!LISTMONK_API_KEY) {
    throw new Error('listmonk_api_key env var is not set');
  }
  return `token ${LISTMONK_USERNAME}:${LISTMONK_API_KEY}`;
}

/**
 * Tiny HTTPS helper — avoids adding axios as a dependency.
 * Returns parsed JSON body or throws on HTTP 4xx/5xx.
 */
function listmonkRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(LISTMONK_BASE_URL + path);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': authHeader(),
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            const err = new Error(
              `Listmonk ${method} ${path} failed — HTTP ${res.statusCode}: ${json.message || data}`
            );
            err.statusCode = res.statusCode;
            err.body = json;
            reject(err);
          } else {
            resolve(json);
          }
        } catch (parseErr) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class ListmonkService {
  /**
   * Send a transactional email via Listmonk /api/tx.
   */
  async sendEmail(toOrOptions, subject, html, _attachments) {
    if (toOrOptions && typeof toOrOptions === 'object' && !Array.isArray(toOrOptions)) {
      const opts = toOrOptions;
      const recipient = opts.to;
      const subj = opts.subject || '(no subject)';
      const body = opts.html || this._buildGenericHtml(opts.subject, opts.context);
      return this._dispatchTx(recipient, subj, body);
    }

    return this._dispatchTx(toOrOptions, subject, html);
  }

  /**
   * Internal: send via Listmonk transactional API.
   */
  async _dispatchTx(to, subject, html) {
    if (!to) {
      logger.warn('[Listmonk] sendEmail called with empty recipient — skipping');
      return null;
    }

    if (process.env.NODE_ENV === 'test') {
      logger.info('[Listmonk] Skipping email in test environment', { to, subject });
      return { skipped: true };
    }

    try {
      const result = await listmonkRequest('POST', '/tx', {
        subscriber_email: to,
        template_id: 1,
        subject,
        data: { body: html },
        content_type: 'html',
      });

      logger.info('[Listmonk] Transactional email sent', { to, subject });
      return result;
    } catch (err) {
      logger.error('[Listmonk] Failed to send transactional email', {
        to, subject, error: err.message, statusCode: err.statusCode,
      });
      return null;
    }
  }

  /**
   * Add/Update subscriber.
   */
  async addSubscriber(email, name, listIds = [ONBOARDING_LIST_ID]) {
    if (!email) return null;
    if (process.env.NODE_ENV === 'test') return { skipped: true };

    try {
      const result = await listmonkRequest('POST', '/subscribers', {
        email,
        name: name || email,
        status: 'enabled',
        lists: listIds,
      });
      logger.info('[Listmonk] Subscriber added/updated', { email, lists: listIds });
      return result;
    } catch (err) {
      if (err.statusCode === 409) {
        logger.info('[Listmonk] Subscriber already exists', { email });
        return { exists: true };
      }
      logger.error('[Listmonk] Failed to add subscriber', { email, error: err.message });
      return null;
    }
  }

  // --- Auth Specific Email Methods ---

  async sendVerificationEmail(email, firstName, otp) {
    const subject = 'Verify your email - CareNest';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #4CAF50;">Welcome to CareNest</h2>
        </div>
        <p>Hi ${firstName || 'there'},</p>
        <p>Thank you for signing up. Please use the code below to verify your email address:</p>
        <div style="margin: 30px 0; text-align: center;">
          <div style="display: inline-block; padding: 15px 30px; background-color: #f9f9f9; border: 2px dashed #4CAF50; border-radius: 5px;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">${otp}</span>
          </div>
        </div>
        <p>This code will expire in 15 minutes.</p>
        <p>If you didn't create an account, you can safely ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">© 2026 CareNest. All rights reserved.</p>
      </div>`;
    return this.sendEmail(email, subject, html);
  }

  async sendPasswordResetEmail(email, otp) {
    const subject = 'Password Reset Code - CareNest';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #1a1a2e;">Password Reset Request</h2>
        </div>
        <p>We received a request to reset your password. Use the code below to proceed:</p>
        <div style="margin: 30px 0; text-align: center;">
          <div style="display: inline-block; padding: 15px 30px; background-color: #f4f4f4; border-radius: 5px;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">${otp}</span>
          </div>
        </div>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn't request a password reset, please secure your account.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">CareNest Security Team</p>
      </div>`;
    return this.sendEmail(email, subject, html);
  }

  async sendPasswordChangeNotification(email, firstName) {
    const subject = 'Your password was changed - CareNest';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #333;">Password Changed Successfully</h2>
        <p>Hi ${firstName || 'there'},</p>
        <p>This is a confirmation that the password for your CareNest account has been successfully changed.</p>
        <p>If you did not perform this action, please contact our support team immediately.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">CareNest Security Notification</p>
      </div>`;
    return this.sendEmail(email, subject, html);
  }

  // --- Legacy helpers ---

  getReceiptTemplate(amount, currency, invoiceNumber, date, paymentMethod) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">Payment Receipt</h1>
        <p>Dear Customer,</p>
        <p>Thank you for your payment. Here are the details:</p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Invoice Number:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${invoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Date:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${date}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Amount Paid:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${Number(amount).toFixed(2)} ${String(currency).toUpperCase()}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Payment Method:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${paymentMethod}</td>
          </tr>
        </table>
        <p>If you have any questions, please contact us.</p>
        <p>Best regards,<br>The CareNest Team</p>
      </div>`;
  }

  getRefundTemplate(amount, currency, invoiceNumber, reason) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">Refund Processed</h1>
        <p>Dear Customer,</p>
        <p>A refund has been processed for your invoice <strong>${invoiceNumber}</strong>.</p>
        <p><strong>Amount Refunded:</strong> ${Number(amount).toFixed(2)} ${String(currency).toUpperCase()}</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p>The funds should appear in your account within 5-10 business days.</p>
        <p>Best regards,<br>The CareNest Team</p>
      </div>`;
  }

  _buildGenericHtml(subject, context = {}) {
    const rows = Object.entries(context)
      .map(([k, v]) => `<tr><td style="padding:6px 0;color:#555;"><strong>${k}:</strong></td><td style="padding:6px 0;">${v}</td></tr>`)
      .join('');

    return `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#1a1a2e;">${subject || ''}</h2>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
        <p style="margin-top:24px;">Best regards,<br>The CareNest Team</p>
      </div>`;
  }
}

module.exports = new ListmonkService();
