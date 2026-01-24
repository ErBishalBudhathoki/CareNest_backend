/**
 * Email Service
 * Handles sending emails for the application
 */

const nodemailer = require('nodemailer');
const logger = require('../config/logger');

class EmailService {
    constructor() {
        // Initialize transporter
        // In a real app, these credentials should be in .env
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.example.com',
            port: process.env.SMTP_PORT || 587,
            secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USER || 'user',
                pass: process.env.SMTP_PASS || 'pass',
            },
        });
    }

    /**
     * Send an email
     * @param {string} to - Recipient email
     * @param {string} subject - Email subject
     * @param {string} text - Plain text body
     * @param {string} html - HTML body
     */
    async sendEmail(to, subject, text, html) {
        if (process.env.NODE_ENV === 'test' || !process.env.SMTP_HOST) {
            logger.info(`[EmailService] Mock send to ${to}: ${subject}`);
            return true;
        }

        try {
            const info = await this.transporter.sendMail({
                from: process.env.SMTP_FROM || '"CareNest" <noreply@carenest.com>',
                to,
                subject,
                text,
                html,
            });
            logger.info(`Message sent: ${info.messageId}`);
            return info;
        } catch (error) {
            logger.error('Error sending email', error);
            // Don't throw, just log failure so we don't break the flow
            return false;
        }
    }

    /**
     * Send onboarding submission email to admin
     */
    async sendOnboardingSubmissionEmail(adminEmail, employeeName) {
        const subject = `New Onboarding Submission: ${employeeName}`;
        const text = `Employee ${employeeName} has submitted their onboarding details. Please review.`;
        const html = `<p>Employee <strong>${employeeName}</strong> has submitted their onboarding details.</p><p>Please review and approve.</p>`;
        
        return this.sendEmail(adminEmail, subject, text, html);
    }

    /**
     * Send welcome email to employee upon completion
     */
    async sendOnboardingWelcomeEmail(employeeEmail, employeeName) {
        const subject = 'Welcome to CareNest!';
        const text = `Hi ${employeeName},\n\nWelcome to the team! Your onboarding is complete.\n\nPlease find the employee handbook attached (link).\n\nBest,\nCareNest Team`;
        const html = `
            <h1>Welcome to CareNest!</h1>
            <p>Hi ${employeeName},</p>
            <p>Welcome to the team! Your onboarding is complete.</p>
            <p>Please find the employee handbook <a href="#">here</a>.</p>
            <p>Best,<br>CareNest Team</p>
        `;
        
        return this.sendEmail(employeeEmail, subject, text, html);
    }

    /**
     * Send probation reminder
     */
    async sendProbationReminder(managerEmail, employeeName, daysRemaining) {
        const subject = `Probation Ending Soon: ${employeeName}`;
        const text = `Employee ${employeeName}'s probation period ends in ${daysRemaining} days.`;
        const html = `<p>Employee <strong>${employeeName}</strong>'s probation period ends in <strong>${daysRemaining}</strong> days.</p>`;
        
        return this.sendEmail(managerEmail, subject, text, html);
    }

    /**
     * Send Overdue Invoice Reminder
     */
    async sendOverdueReminder(invoice) {
        const subject = `Overdue Invoice #${invoice.invoiceNumber} - Action Required`;
        const text = `Dear ${invoice.clientName},\n\nThis is a friendly reminder that invoice #${invoice.invoiceNumber} for $${invoice.payment.balanceDue.toFixed(2)} was due on ${new Date(invoice.financialSummary.dueDate).toDateString()}.\n\nPlease arrange payment at your earliest convenience.\n\nThank you,\nCareNest`;
        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #D02020;">Invoice Overdue Reminder</h2>
                <p>Dear ${invoice.clientName},</p>
                <p>This is a friendly reminder that invoice <strong>#${invoice.invoiceNumber}</strong> was due on ${new Date(invoice.financialSummary.dueDate).toDateString()}.</p>
                <p style="font-size: 18px;"><strong>Balance Due: $${invoice.payment.balanceDue.toFixed(2)}</strong></p>
                <p>Please arrange payment at your earliest convenience.</p>
                <a href="#" style="background-color: #1D55C0; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Pay Now</a>
                <p>Thank you,<br>CareNest</p>
            </div>
        `;
        return this.sendEmail(invoice.clientEmail, subject, text, html);
    }

    /**
     * Send Payment Receipt
     */
    async sendPaymentReceipt(invoice, amount) {
        const subject = `Payment Receipt for Invoice #${invoice.invoiceNumber}`;
        const text = `Dear ${invoice.clientName},\n\nThank you for your payment of $${amount.toFixed(2)} for invoice #${invoice.invoiceNumber}.\n\nRemaining Balance: $${invoice.payment.balanceDue.toFixed(2)}\n\nThank you,\nCareNest`;
        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2 style="color: #1D55C0;">Payment Received</h2>
                <p>Dear ${invoice.clientName},</p>
                <p>Thank you for your payment of <strong>$${amount.toFixed(2)}</strong> for invoice #${invoice.invoiceNumber}.</p>
                <p><strong>Remaining Balance: $${invoice.payment.balanceDue.toFixed(2)}</strong></p>
                <p>Thank you,<br>CareNest</p>
            </div>
        `;
        return this.sendEmail(invoice.clientEmail, subject, text, html);
    }
    /**
     * Send Client Activation Email
     */
    async sendClientActivationEmail(email, tempPassword) {
        const subject = 'Activate Your Client Portal Account';
        const text = `Welcome to CareNest!\n\nYour client portal account has been created. Please log in using the following temporary credentials:\n\nEmail: ${email}\nTemporary Password: ${tempPassword}\n\nYou will be required to change your password upon first login.\n\nLogin here: [App Link]\n\nBest,\nCareNest Team`;
        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
                <h2 style="color: #1D55C0;">Welcome to CareNest!</h2>
                <p>Your client portal account has been created.</p>
                <p>Please log in using the following temporary credentials:</p>
                <div style="background-color: #f5f5f5; padding: 15px; border-radius: 4px; margin: 20px 0;">
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Temporary Password:</strong> ${tempPassword}</p>
                </div>
                <p><strong>Important:</strong> You will be required to change your password upon first login.</p>
                <p>Best,<br>CareNest Team</p>
            </div>
        `;
        return this.sendEmail(email, subject, text, html);
    }
}

module.exports = new EmailService();
