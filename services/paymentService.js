const mongoose = require('mongoose');
const { Invoice, PaymentStatus } = require('../models/Invoice');
const { CreditNote, CreditNoteStatus } = require('../models/CreditNote');
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
   */
  async createPaymentIntent(invoiceId, amount, currency = 'aud', clientEmail) {
    if (!this.stripeEnabled) {
      throw new Error('Stripe is not configured on the server');
    }

    try {
      // Amount in cents
      const amountInCents = Math.round(amount * 100);
      
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: currency.toLowerCase(),
        metadata: { invoiceId, clientEmail },
        receipt_email: clientEmail,
        automatic_payment_methods: { enabled: true },
      });

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      };
    } catch (error) {
      console.error('Error creating payment intent:', error);
      throw error;
    }
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
}

module.exports = new PaymentService();
