const { Invoice, PaymentStatus } = require('../models/Invoice');
const { CreditNote, CreditNoteStatus } = require('../models/CreditNote');
const Organization = require('../models/Organization');
const auditService = require('./auditService');

// Conditionally load Stripe
let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

class PaymentService {
  constructor() {
    this.stripeEnabled = !!process.env.STRIPE_SECRET_KEY;
    if (!this.stripeEnabled) {
      console.warn('WARNING: STRIPE_SECRET_KEY is not set. Payment processing will be disabled.');
    }
  }

  /**
   * Create a Payment Intent via Stripe
   * Supports Stripe Connect (Standard) if organizationId is provided and has a connected account.
   */
  async createPaymentIntent(invoiceId, amount, currency = 'aud', clientEmail, organizationId) {
    if (!this.stripeEnabled) {
      throw new Error('Stripe is not configured on the server');
    }

    try {
      // 1. Check for Connected Account
      let stripeAccountHeader = {};
      if (organizationId) {
        const org = await Organization.findById(organizationId);
        if (org && org.stripeAccountId) {
           // For Standard Connect, we authenticate as the connected account
           stripeAccountHeader = { stripeAccount: org.stripeAccountId };
        }
      }

      // Amount in cents
      const amountInCents = Math.round(amount * 100);
      
      const paymentIntentPayload = {
        amount: amountInCents,
        currency: currency.toLowerCase(),
        metadata: { invoiceId, clientEmail, organizationId },
        receipt_email: clientEmail,
        automatic_payment_methods: { enabled: true },
      };

      // If we are a platform taking a fee, we would add application_fee_amount here.
      // For now, we just pass the full amount to the connected account.

      const paymentIntent = await stripe.paymentIntents.create(
        paymentIntentPayload,
        stripeAccountHeader // This routes the payment to the connected account
      );

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        connectedAccountId: stripeAccountHeader.stripeAccount
      };
    } catch (error) {
      console.error('Error creating payment intent:', error);
      throw error;
    }
  }

  /**
   * Generate Stripe Connect Onboarding Link
   */
  async createOnboardingLink(organizationId, userEmail) {
    if (!this.stripeEnabled) throw new Error('Stripe not configured');

    const org = await Organization.findById(organizationId);
    if (!org) throw new Error('Organization not found');

    // 1. Create a Standard Connect Account if not exists
    if (!org.stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
        email: org.contactDetails?.email || userEmail,
        country: 'AU', // Defaulting to AU for NDIS
      });
      org.stripeAccountId = account.id;
      await org.save();
    }

    // 2. Create Account Link
    const accountLink = await stripe.accountLinks.create({
      account: org.stripeAccountId,
      refresh_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/stripe/refresh`, // TODO: Define frontend routes
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/stripe/return`,
      type: 'account_onboarding',
    });

    return { url: accountLink.url };
  }

  /**
   * Record a payment (manual or Stripe success)
   */
  async recordPayment(invoiceId, paymentData, userEmail) {
    try {
      const invoice = await Invoice.findById(invoiceId);
      if (!invoice) throw new Error('Invoice not found');

      const amount = Number(paymentData.amount);
      const newPaidAmount = (invoice.payment?.paidAmount || 0) + amount;
      const totalAmount = invoice.financialSummary.totalAmount;
      const balanceDue = totalAmount - newPaidAmount;

      let newStatus = PaymentStatus.PARTIAL;
      if (balanceDue <= 0.01) { // Tolerance for float errors
        newStatus = PaymentStatus.PAID;
      }

      const transaction = {
        date: new Date(),
        amount: amount,
        method: paymentData.method, // 'stripe', 'bank_transfer', etc.
        reference: paymentData.reference,
        status: 'success',
        notes: paymentData.notes
      };

      // Update using Mongoose document
      invoice.payment.status = newStatus;
      invoice.payment.paidAmount = newPaidAmount;
      invoice.payment.balanceDue = balanceDue;
      invoice.payment.paidDate = newStatus === PaymentStatus.PAID ? new Date() : null;
      invoice.payment.lastReminderDate = null; // Reset reminder
      invoice.payment.transactions.push(transaction);

      await invoice.save();

      if (userEmail) {
        await auditService.logAction({
          userEmail,
          action: 'PAYMENT_RECORDED',
          details: { invoiceId, amount, method: paymentData.method },
          timestamp: new Date()
        });
      }

      // Send Email Receipt
      if (invoice.clientEmail) {
        const emailHtml = emailService.getReceiptTemplate(
          amount, 
          'AUD', 
          invoice.invoiceNumber, 
          new Date().toLocaleDateString(), 
          paymentData.method
        );
        // Don't await email sending to keep response fast
        emailService.sendEmail(invoice.clientEmail, `Payment Receipt: ${invoice.invoiceNumber}`, emailHtml);
      }

      return { success: true, newStatus, balanceDue };
    } catch (error) {
      console.error('Error recording payment:', error);
      throw error;
    }
  }

  /**
   * Create a Credit Note
   */
  async createCreditNote(creditNoteData, userEmail) {
    try {
      const creditNote = new CreditNote({
        ...creditNoteData,
        organizationId: creditNoteData.organizationId,
        status: CreditNoteStatus.ISSUED,
        balanceRemaining: creditNoteData.amount,
        createdAt: new Date(),
        createdBy: userEmail,
        applications: [],
        refunds: []
      });

      const savedCreditNote = await creditNote.save();
      
      // If linked to an invoice, link it back
      if (creditNoteData.originalInvoiceId) {
        await Invoice.updateOne(
          { _id: creditNoteData.originalInvoiceId },
          { 
            $push: { 
              creditNotes: {
                creditNoteId: savedCreditNote._id,
                creditNoteNumber: creditNoteData.creditNoteNumber,
                amount: creditNoteData.amount,
                appliedDate: new Date(),
                reason: creditNoteData.reason
              }
            }
          }
        );
      }

      return { success: true, creditNoteId: savedCreditNote._id };
    } catch (error) {
      console.error('Error creating credit note:', error);
      throw error;
    }
  }

  /**
   * Apply Credit Note to an Invoice
   */
  async applyCreditNote(creditNoteId, invoiceId, amountToApply, userEmail) {
    try {
      const creditNote = await CreditNote.findById(creditNoteId);
      const invoice = await Invoice.findById(invoiceId);
      
      if (!creditNote || !invoice) throw new Error('Credit Note or Invoice not found');
      if (creditNote.balanceRemaining < amountToApply) throw new Error('Insufficient credit balance');

      // 1. Update Invoice (Treat as payment)
      await this.recordPayment(invoiceId, {
        amount: amountToApply,
        method: 'credit_note',
        reference: creditNote.creditNoteNumber,
        notes: `Applied from CN ${creditNote.creditNoteNumber}`
      }, userEmail);

      // 2. Update Credit Note
      const newBalance = creditNote.balanceRemaining - amountToApply;
      let newStatus = creditNote.status;
      if (newBalance <= 0) newStatus = CreditNoteStatus.APPLIED;
      else newStatus = CreditNoteStatus.PARTIAL;

      creditNote.balanceRemaining = newBalance;
      creditNote.status = newStatus;
      creditNote.applications.push({
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        amountApplied: amountToApply,
        date: new Date()
      });

      await creditNote.save();

      return { success: true, remainingCredit: newBalance };
    } catch (error) {
      console.error('Error applying credit note:', error);
      throw error;
    }
  }

  /**
   * Process a refund
   */
  async processRefund(invoiceId, amount, reason, userEmail) {
    try {
      const invoice = await Invoice.findById(invoiceId);
      if (!invoice) throw new Error('Invoice not found');

      // Validate refund amount
      if (amount > (invoice.payment?.paidAmount || 0)) {
        throw new Error('Refund amount cannot exceed paid amount');
      }

      // Update invoice
      const newPaidAmount = (invoice.payment?.paidAmount || 0) - amount;
      const totalAmount = invoice.financialSummary.totalAmount;
      const balanceDue = totalAmount - newPaidAmount;

      let newStatus = 'partial'; // Default to partial
      if (balanceDue >= totalAmount - 0.01) {
        newStatus = 'pending'; // Fully refunded / Unpaid
      } else if (balanceDue <= 0.01) {
        newStatus = 'paid'; // Still paid (e.g. partial refund of overpayment? unlikely case)
      }

      const transaction = {
        date: new Date(),
        amount: -amount, // Negative amount for refund
        method: 'refund',
        reference: reason,
        status: 'success',
        notes: `Refund processed by ${userEmail}`
      };

      if (!invoice.payment) invoice.payment = {};
      invoice.payment.status = newStatus;
      invoice.payment.paidAmount = newPaidAmount;
      invoice.payment.balanceDue = balanceDue;
      invoice.payment.transactions.push(transaction);

      await invoice.save();

      if (auditService && auditService.logAction) {
          await auditService.logAction({
            userEmail,
            action: 'PAYMENT_REFUNDED',
            details: { invoiceId, amount, reason },
            timestamp: new Date()
          });
      }

      // Send Refund Notification
      if (invoice.clientEmail) {
        const emailHtml = emailService.getRefundTemplate(
          amount, 
          'AUD', 
          invoice.invoiceNumber, 
          reason
        );
        emailService.sendEmail(invoice.clientEmail, `Refund Notification: ${invoice.invoiceNumber}`, emailHtml);
      }

      return { success: true, newStatus, balanceDue };
    } catch (error) {
      console.error('Error processing refund:', error);
      throw error;
    }
  }
}

module.exports = new PaymentService();
