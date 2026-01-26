const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initTransporter();
  }

  initTransporter() {
    try {
      this.transporter = nodemailer.createTransporter({
        service: 'gmail',
        auth: {
          user: process.env.ADMIN_EMAIL, 
          pass: process.env.APP_PASSWORD,
        },
      });
    } catch (error) {
      console.warn('Failed to initialize email transporter. Email service will be disabled.', error.message);
    }
  }

  async sendEmail(to, subject, html, attachments = []) {
    if (!this.transporter) {
      console.warn('Email service not initialized. Skipping email send.');
      return null;
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"CareNest" <${process.env.ADMIN_EMAIL}>`,
        to,
        subject,
        html,
        attachments,
      });
      console.log('Email sent: %s', info.messageId);
      return info;
    } catch (error) {
      console.error('Error sending email:', error);
      // Don't throw, just log, so payment doesn't fail if email fails
      return null;
    }
  }

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
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${(amount).toFixed(2)} ${currency.toUpperCase()}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Payment Method:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${paymentMethod}</td>
          </tr>
        </table>
        <p>If you have any questions, please contact us.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `;
  }

  getRefundTemplate(amount, currency, invoiceNumber, reason) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">Refund Processed</h1>
        <p>Dear Customer,</p>
        <p>A refund has been processed for your invoice <strong>${invoiceNumber}</strong>.</p>
        <p><strong>Amount Refunded:</strong> ${(amount).toFixed(2)} ${currency.toUpperCase()}</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p>The funds should appear in your account within 5-10 business days.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `;
  }
}

module.exports = new EmailService();
