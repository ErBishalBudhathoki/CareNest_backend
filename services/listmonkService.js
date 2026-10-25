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
 */

const https = require('https');
const logger = require('../config/logger');

const LISTMONK_BASE_URL    = process.env.LISTMONK_BASE_URL    || 'https://listmonk.bishalbudhathoki.com/api';
const LISTMONK_API_KEY     = process.env.listmonk_api_key;
const LISTMONK_USERNAME    = process.env.LISTMONK_USERNAME    || 'carenest';
const ONBOARDING_LIST_ID   = parseInt(process.env.LISTMONK_ONBOARDING_LIST_ID || '3', 10);
// Preferred tx template. Treated as a hint: if it is missing or is not a
// type=tx template, the service finds (or creates) a usable one instead.
const LISTMONK_TEMPLATE_ID = parseInt(process.env.LISTMONK_TEMPLATE_ID || '1', 10);

// Listmonk renders /tx through a transactional (type=tx) template. The HTML we
// pass in `data.body` only reaches the recipient if the template prints it and
// marks it safe (Listmonk compiles tx templates with html/template). A template
// without this expression sends a blank body while still returning HTTP 200.
const TX_TEMPLATE_BODY   = '{{ .Tx.Data.body | Safe }}';
const TX_TEMPLATE_NAME   = 'CareNest Transactional';
const TX_BODY_SAFE_REGEX = /\.Tx\.Data\.body\s*\|\s*Safe/;

function authHeader() {
  if (!LISTMONK_API_KEY) {
    throw new Error('listmonk_api_key env var is not set');
  }
  return `token ${LISTMONK_USERNAME}:${LISTMONK_API_KEY}`;
}

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
  constructor() {
    // Template id actually used for sends. Seeded from the env var and replaced
    // with the id Listmonk assigns if the template has to be created.
    this._txTemplateId = LISTMONK_TEMPLATE_ID;
    this._txTemplateCheck = null;
  }

  /**
   * Resolve and, if needed, repair the transactional template used for sends.
   *
   * Runs once per process (memoised), so a misconfigured template is repaired
   * on the first email instead of silently producing blank emails forever.
   * Never throws: a failure here must not block the send itself.
   */
  ensureTxTemplate() {
    if (!this._txTemplateCheck) {
      this._txTemplateCheck = this._syncTxTemplate().catch((err) => {
        this._txTemplateCheck = null; // retry on the next send
        logger.error('[Listmonk] Could not verify the transactional template', {
          templateId: this._txTemplateId,
          error: err.message,
          statusCode: err.statusCode,
        });
      });
    }
    return this._txTemplateCheck;
  }

  async _syncTxTemplate() {
    const configuredId = LISTMONK_TEMPLATE_ID;
    const configured = await this._getTemplate(configuredId);

    if (configured && configured.type === 'tx') {
      if (TX_BODY_SAFE_REGEX.test(configured.body || '')) {
        this._txTemplateId = configured.id || configuredId;
        return;
      }

      await this._writeTxTemplate(configured);
      logger.warn(
        '[Listmonk] Transactional template did not output the email body — rewrote it',
        {
          templateId: this._txTemplateId,
          reason: configured.body
            ? 'missing {{ .Tx.Data.body | Safe }}'
            : 'empty template body',
        }
      );
      return;
    }

    // `LISTMONK_TEMPLATE_ID` is wrong: it is missing, or it points at a campaign
    // template (Listmonk's default seed is id 1 = "Default campaign template").
    // `/tx` only accepts type=tx templates — a campaign id is rejected with
    // 400 "template 1 not found" — and a campaign record must never be
    // rewritten. So fall back to a real tx template and leave the campaign alone.
    if (configured) {
      logger.error(
        '[Listmonk] LISTMONK_TEMPLATE_ID does not point at a transactional template — ignoring it',
        { templateId: configuredId, type: configured.type, name: configured.name }
      );
    } else {
      logger.warn('[Listmonk] LISTMONK_TEMPLATE_ID does not exist', {
        templateId: configuredId,
      });
    }

    const txTemplates = await this._listTxTemplates();
    const usable =
      txTemplates.find((t) => TX_BODY_SAFE_REGEX.test(t.body || '')) ||
      txTemplates[0];

    if (!usable) {
      await this._createTxTemplate();
      return;
    }

    if (!TX_BODY_SAFE_REGEX.test(usable.body || '')) {
      await this._writeTxTemplate(usable);
      logger.warn(
        '[Listmonk] Transactional template did not output the email body — rewrote it',
        { templateId: this._txTemplateId, configuredId }
      );
      return;
    }

    this._txTemplateId = usable.id;
    logger.warn(
      '[Listmonk] LISTMONK_TEMPLATE_ID is not usable — using an existing transactional template',
      { templateId: usable.id, name: usable.name, configuredId }
    );
  }

  async _getTemplate(id) {
    try {
      const res = await listmonkRequest('GET', `/templates/${id}`);
      return (res && res.data) || null;
    } catch (err) {
      // Listmonk answers a missing template with 400 {"message":"Template not
      // found"}, not 404, so treat both as "absent" instead of an outage.
      const message = String(
        (err.body && err.body.message) || err.message || ''
      ).toLowerCase();

      if (err.statusCode === 404 || (err.statusCode === 400 && message.includes('not found'))) {
        return null;
      }
      throw err;
    }
  }

  /**
   * All templates of type=tx. Only these are cached by Listmonk for `/tx`;
   * campaign and campaign_visual templates are not accepted there.
   */
  async _listTxTemplates() {
    const txTemplates = [];

    for (let page = 1; page <= 5; page += 1) {
      const res = await listmonkRequest('GET', `/templates?page=${page}&per_page=100`);
      const rows = res && Array.isArray(res.data) ? res.data : [];
      txTemplates.push(...rows.filter((row) => row && row.type === 'tx'));

      const total = res && typeof res.total === 'number' ? res.total : rows.length;
      if (rows.length < 100 || page * 100 >= total) break;
    }

    return txTemplates;
  }

  async _writeTxTemplate(tpl) {
    await listmonkRequest('PUT', `/templates/${tpl.id}`, {
      name: tpl.name || TX_TEMPLATE_NAME,
      subject: tpl.subject || '',
      type: 'tx',
      body: TX_TEMPLATE_BODY,
    });
    this._txTemplateId = tpl.id;
  }

  async _createTxTemplate() {
    const created = await listmonkRequest('POST', '/templates', {
      name: TX_TEMPLATE_NAME,
      subject: '',
      type: 'tx',
      body: TX_TEMPLATE_BODY,
    });

    const createdId = created && created.data && created.data.id;
    if (createdId) {
      this._txTemplateId = createdId;
    }
    logger.warn('[Listmonk] Transactional template was missing — created it', {
      templateId: this._txTemplateId,
    });
  }

  /**
   * Universal CareNest Email Wrapper
   * Ensures consistent branding, header, body, and footer across ALL emails.
   */
  _wrapCareNestEmail(title, content) {
    const currentYear = new Date().getFullYear();
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
    <!-- Header -->
    <div style="background-color: #1A3BA0; padding: 30px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600; letter-spacing: 1px;">CareNest</h1>
    </div>
    <!-- Body -->
    <div style="padding: 40px 30px; color: #333333; line-height: 1.6; font-size: 16px;">
      <h2 style="color: #1A3BA0; margin-top: 0; margin-bottom: 24px; font-size: 22px;">${title}</h2>
      ${content}
    </div>
    <!-- Footer -->
    <div style="background-color: #f9fafb; padding: 24px 30px; text-align: center; border-top: 1px solid #eeeeee;">
      <p style="margin: 0; color: #888888; font-size: 13px; line-height: 1.5;">
        © ${currentYear} CareNest. All rights reserved.<br>
        Need help? Contact our <a href="mailto:support@carenest.com.au" style="color: #1A3BA0; text-decoration: none;">Support Team</a>
      </p>
    </div>
  </div>
</body>
</html>`;
  }

  async sendEmail(toOrOptions, subject, html, _attachments, extraData = {}) {
    if (toOrOptions && typeof toOrOptions === 'object' && !Array.isArray(toOrOptions)) {
      const opts = toOrOptions;
      const recipient = opts.to;
      const subj = opts.subject || '(no subject)';
      const body = opts.html || this._buildGenericHtml(opts.subject, opts.context);
      return this._dispatchTx(recipient, subj, body, opts.data || extraData);
    }
    return this._dispatchTx(toOrOptions, subject, html, extraData);
  }

  async _dispatchTx(to, subject, html, extraData = {}) {
    if (!to) {
      logger.warn('[Listmonk] sendEmail called with empty recipient — skipping');
      return null;
    }
    if (process.env.NODE_ENV === 'test') {
      logger.info('[Listmonk] Skipping email in test environment', { to, subject });
      return { skipped: true };
    }

    await this.ensureTxTemplate();

    try {
      const result = await listmonkRequest('POST', '/tx', {
        subscriber_email: to,
        // `fallback` renders and sends even when the recipient is not a
        // registered Listmonk subscriber (e.g. accounts created before the
        // signup flow started calling addSubscriber). The default mode drops
        // those recipients with a 400 that used to be swallowed below.
        subscriber_mode: 'fallback',
        template_id: this._txTemplateId,
        subject,
        data: {
          body: html,
          ...extraData,
        },
        content_type: 'html',
      });
      logger.info('[Listmonk] Transactional email sent', { to, subject });
      return result;
    } catch (err) {
      logger.error('[Listmonk] Failed to send transactional email', {
        to,
        subject,
        templateId: this._txTemplateId,
        error: err.message,
        statusCode: err.statusCode,
        response: err.body && (err.body.message || err.body),
      });
      return null;
    }
  }

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

  // --- Onboarding Email Methods ---

  /**
   * Welcome email sent after an employee completes onboarding.
   *
   * This method was referenced by services/onboardingService.js but did not
   * exist, so every onboarding completion logged
   * "emailService.sendOnboardingWelcomeEmail is not a function" and silently sent
   * nothing. The throw was swallowed by the caller's try/catch, which is why it
   * went unnoticed.
   *
   * @param {string} email  Recipient address.
   * @param {string} name   Recipient's full name.
   * @param {string} [organizationName]  Organisation they joined, if known.
   */
  async sendOnboardingWelcomeEmail(email, name, organizationName) {
    const subject = 'Welcome to CareNest';
    const orgLine = organizationName
      ? `<p>You have been onboarded to <strong>${organizationName}</strong>.</p>`
      : '';

    const content = `
      <p>Hi ${name || 'there'},</p>
      <p>Welcome to CareNest. Your account is set up and ready to go.</p>
      ${orgLine}
      <p>Here is what you can do from the app:</p>
      <ul style="padding-left: 20px; color: #333333;">
        <li style="margin-bottom: 8px;">View and confirm your shifts and timesheets.</li>
        <li style="margin-bottom: 8px;">Track your earnings and download payslips.</li>
        <li style="margin-bottom: 8px;">Keep your qualifications and documents up to date.</li>
      </ul>
      <p>If anything looks wrong with your profile, reply to this email and we will help.</p>
    `;

    const html = this._wrapCareNestEmail('Welcome aboard', content);
    return this.sendEmail(email, subject, html);
  }

  // --- Auth Specific Email Methods ---

  async sendVerificationEmail(email, firstName, otp) {
    const subject = 'Verify your email - CareNest';
    const content = `
      <p>Hi ${firstName || 'there'},</p>
      <p>Thank you for signing up. Please use the code below to verify your email address:</p>
      <div style="margin: 35px 0; text-align: center;">
        <div style="display: inline-block; padding: 15px 30px; background-color: #f9f9f9; border: 2px dashed #1A3BA0; border-radius: 8px;">
          <span style="font-size: 34px; font-weight: bold; letter-spacing: 8px; color: #1A3BA0;">${otp}</span>
        </div>
      </div>
      <p>This code will expire in 15 minutes.</p>
      <p style="margin-top: 30px; font-size: 14px; color: #666;">If you didn't create an account, you can safely ignore this email.</p>
    `;
    const html = this._wrapCareNestEmail('Welcome to CareNest', content);
    return this.sendEmail(email, subject, html, null, { otp, code: otp, token: otp, firstName });
  }

  async sendPasswordResetEmail(email, otp) {
    const subject = 'Password Reset Code - CareNest';
    const content = `
      <p>We received a request to reset your password. Use the code below to proceed:</p>
      <div style="margin: 35px 0; text-align: center;">
        <div style="display: inline-block; padding: 15px 30px; background-color: #f4f4f4; border-radius: 8px; border: 1px solid #e0e0e0;">
          <span style="font-size: 34px; font-weight: bold; letter-spacing: 8px; color: #333333;">${otp}</span>
        </div>
      </div>
      <p>This code will expire in 10 minutes.</p>
      <p style="margin-top: 30px; font-size: 14px; color: #666;">If you didn't request a password reset, please secure your account immediately.</p>
    `;
    const html = this._wrapCareNestEmail('Password Reset Request', content);
    return this.sendEmail(email, subject, html, null, { otp, code: otp, token: otp });
  }

  async sendPasswordChangeNotification(email, firstName) {
    const subject = 'Your password was changed - CareNest';
    const content = `
      <p>Hi ${firstName || 'there'},</p>
      <p>This is a confirmation that the password for your CareNest account has been successfully changed.</p>
      <p style="margin-top: 30px; font-size: 14px; color: #666;">If you did not perform this action, please contact our support team immediately to secure your account.</p>
    `;
    const html = this._wrapCareNestEmail('Password Changed Successfully', content);
    return this.sendEmail(email, subject, html);
  }

  // --- Legacy helpers ---

  getReceiptTemplate(amount, currency, invoiceNumber, date, paymentMethod) {
    const content = `
      <p>Dear Customer,</p>
      <p>Thank you for your payment. Here are the details of your transaction:</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 20px;">
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eeeeee; color: #555;"><strong>Invoice Number:</strong></td>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eeeeee; text-align: right;">${invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eeeeee; color: #555;"><strong>Date:</strong></td>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eeeeee; text-align: right;">${date}</td>
        </tr>
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eeeeee; color: #555;"><strong>Amount Paid:</strong></td>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eeeeee; text-align: right; font-weight: bold; color: #1A3BA0;">${Number(amount).toFixed(2)} ${String(currency).toUpperCase()}</td>
        </tr>
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eeeeee; color: #555;"><strong>Payment Method:</strong></td>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eeeeee; text-align: right;">${paymentMethod}</td>
        </tr>
      </table>
      <p>We appreciate your business.</p>
    `;
    return this._wrapCareNestEmail('Payment Receipt', content);
  }

  getRefundTemplate(amount, currency, invoiceNumber, reason) {
    const content = `
      <p>Dear Customer,</p>
      <p>A refund has been processed for your invoice <strong>${invoiceNumber}</strong>.</p>
      <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="margin-top: 0;"><strong>Amount Refunded:</strong> <span style="color: #1A3BA0; font-weight: bold;">${Number(amount).toFixed(2)} ${String(currency).toUpperCase()}</span></p>
        <p style="margin-bottom: 0;"><strong>Reason:</strong> ${reason}</p>
      </div>
      <p>The funds should appear in your account within 5-10 business days depending on your bank.</p>
    `;
    return this._wrapCareNestEmail('Refund Processed', content);
  }

  _buildGenericHtml(subject, context = {}) {
    const rows = Object.entries(context)
      .map(([k, v]) => `
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eeeeee; color: #555;"><strong>${k}:</strong></td>
          <td style="padding: 12px 8px; border-bottom: 1px solid #eeeeee;">${v}</td>
        </tr>`)
      .join('');

    const content = `
      <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
        ${rows}
      </table>
    `;
    return this._wrapCareNestEmail(subject || 'Notification', content);
  }
}

module.exports = new ListmonkService();
