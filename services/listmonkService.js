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
 * Additionally exposes:
 *   emailService.addSubscriber(email, name, listIds?)
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
// Listmonk supports two schemes:
//   - API key only (newer): "token api_key"
//   - User:Token (classic): "token username:api_key"
// We try API-key-only first; if your setup needs user:key change this string.
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
   *
   * Compatible with the old nodemailer call:
   *   emailService.sendEmail(to, subject, html, attachments?)
   *
   * Also handles the dunningService object-style call:
   *   emailService.sendEmail({ to, subject, template, context })
   */
  async sendEmail(toOrOptions, subject, html, _attachments) {
    // Support object-style call from dunningService
    if (toOrOptions && typeof toOrOptions === 'object' && !Array.isArray(toOrOptions)) {
      const opts = toOrOptions;
      const recipient = opts.to;
      const subj = opts.subject || '(no subject)';
      // Build a basic HTML from context if no html body is provided
      const body = opts.html || this._buildGenericHtml(opts.subject, opts.context);
      return this._dispatchTx(recipient, subj, body);
    }

    return this._dispatchTx(toOrOptions, subject, html);
  }

  /**
   * Internal: send via Listmonk transactional API.
   * Uses template_id: 1 ("base") as the wrapper, passing the full HTML
   * as `body` so Listmonk renders it as-is.
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
        template_id: 1,          // Your default/base template in Listmonk
        subject,
        data: { body: html },    // Pass full HTML body as a template variable {{ .Data.body }}
        content_type: 'html',
      });

      logger.info('[Listmonk] Transactional email sent', { to, subject });
      return result;
    } catch (err) {
      // Never crash the caller — log and return null (same behaviour as old nodemailer)
      logger.error('[Listmonk] Failed to send transactional email', {
        to, subject, error: err.message, statusCode: err.statusCode,
      });
      return null;
    }
  }

  /**
   * Add a subscriber to a Listmonk list.
   * Used automatically when new employees register (sign-in(onboarding) list ID 3).
   *
   * @param {string} email
   * @param {string} name
   * @param {number[]} listIds  — defaults to [3] (sign-in/onboarding list)
   */
  async addSubscriber(email, name, listIds = [ONBOARDING_LIST_ID]) {
    if (!email) return null;

    if (process.env.NODE_ENV === 'test') {
      return { skipped: true };
    }

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
      // 409 = already exists — upsert gracefully
      if (err.statusCode === 409) {
        logger.info('[Listmonk] Subscriber already exists', { email });
        return { exists: true };
      }
      logger.error('[Listmonk] Failed to add subscriber', { email, error: err.message });
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Legacy template helpers — kept identical so paymentService doesn't break
  // ---------------------------------------------------------------------------

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

  /**
   * Builds a minimal HTML email from a subject + context object.
   * Used as a fallback for dunningService's template-style calls.
   */
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
