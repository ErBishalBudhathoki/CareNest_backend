/**
 * Dunning Service
 * Handles automated follow-ups for overdue invoices
 * 
 * @file backend/services/dunningService.js
 */

const { Invoice, InvoiceStatus, PaymentStatus } = require('../models/Invoice');
const emailService = require('./emailService');
const logger = require('../config/logger');

class DunningService {
    /**
     * Process overdue invoices and send reminders
     * @returns {Promise<Object>} Stats
     */
    async processOverdueInvoices() {
        try {
            const today = new Date();
            const remindersSent = [];
            const errors = [];

            // Find invoices that are overdue or due soon and not fully paid
            // Logic: 
            // 1. Due date is in the past
            // 2. Status is NOT 'paid' or 'cancelled'
            // 3. Payment status is NOT 'paid'
            // 4. Haven't sent a reminder today
            
            const query = {
                'financialSummary.dueDate': { $lt: today },
                'workflow.status': { $in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
                'payment.status': { $in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL, PaymentStatus.OVERDUE] },
                'deletion.isDeleted': false,
                $or: [
                    { 'payment.lastReminderDate': { $exists: false } },
                    { 'payment.lastReminderDate': { $lt: new Date(today.getTime() - 24 * 60 * 60 * 1000) } } // At least 24h ago
                ]
            };

            const overdueInvoices = await Invoice.find(query);

            logger.info(`Found ${overdueInvoices.length} overdue invoices to check for dunning.`);

            for (const invoice of overdueInvoices) {
                try {
                    const daysOverdue = Math.floor((today - new Date(invoice.financialSummary.dueDate)) / (1000 * 60 * 60 * 24));
                    
                    // Determine if we should send a reminder based on "3, 7, 14, 30" day rules
                    // Or just if it hasn't been sent for this "tier"
                    
                    let shouldSend = false;
                    let templateName = 'invoice-reminder';

                    if (daysOverdue >= 3 && daysOverdue < 7 && invoice.payment.remindersSent < 1) {
                        shouldSend = true;
                    } else if (daysOverdue >= 7 && daysOverdue < 14 && invoice.payment.remindersSent < 2) {
                        shouldSend = true;
                        templateName = 'invoice-reminder-urgent';
                    } else if (daysOverdue >= 14 && invoice.payment.remindersSent < 3) {
                        shouldSend = true;
                        templateName = 'invoice-reminder-final';
                    }

                    if (shouldSend) {
                        await this.sendReminder(invoice, daysOverdue, templateName);
                        
                        // Update invoice
                        invoice.payment.remindersSent = (invoice.payment.remindersSent || 0) + 1;
                        invoice.payment.lastReminderDate = new Date();
                        
                        // Update status to OVERDUE if not already
                        if (invoice.workflow.status !== InvoiceStatus.OVERDUE) {
                            invoice.workflow.status = InvoiceStatus.OVERDUE;
                            invoice.payment.status = PaymentStatus.OVERDUE;
                        }

                        await invoice.save();
                        remindersSent.push(invoice.invoiceNumber);
                    }

                } catch (err) {
                    logger.error(`Error processing dunning for invoice ${invoice.invoiceNumber}`, err);
                    errors.push({ invoice: invoice.invoiceNumber, error: err.message });
                }
            }

            return {
                processed: overdueInvoices.length,
                sent: remindersSent.length,
                errors: errors.length,
                details: { sent: remindersSent, errors }
            };

        } catch (error) {
            logger.error('Critical error in processOverdueInvoices', error);
            throw error;
        }
    }

    /**
     * Send reminder email
     */
    async sendReminder(invoice, daysOverdue, template) {
        const recipient = invoice.delivery.recipientEmail || invoice.clientEmail;
        
        if (!recipient) {
            throw new Error('No recipient email found');
        }

        const subject = `Overdue Invoice ${invoice.invoiceNumber} - ${daysOverdue} Days Late`;
        
        // Use emailService
        // Assuming emailService has sendEmail method
        await emailService.sendEmail({
            to: recipient,
            subject: subject,
            template: template,
            context: {
                clientName: invoice.clientName,
                invoiceNumber: invoice.invoiceNumber,
                dueDate: invoice.financialSummary.dueDate.toLocaleDateString(),
                amountDue: invoice.payment.balanceDue || invoice.financialSummary.totalAmount,
                paymentLink: `https://app.carenest.com.au/pay/${invoice._id}` // Example link
            }
        });

        logger.info(`Sent ${template} to ${recipient} for invoice ${invoice.invoiceNumber}`);
    }
}

module.exports = new DunningService();
