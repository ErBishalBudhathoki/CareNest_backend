const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const { PaymentStatus } = require('../models/invoiceSchema');
const { CreditNoteStatus } = require('../models/CreditNote');
const auditService = require('./auditService');

// Conditionally load Stripe
let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

class PaymentService {
  constructor() {
    this.uri = process.env.MONGODB_URI;
    this.stripeEnabled = !!process.env.STRIPE_SECRET_KEY;
    if (!this.stripeEnabled) {
      console.warn('WARNING: STRIPE_SECRET_KEY is not set. Payment processing will be disabled.');
    }
  }

  async getDb() {
    const client = new MongoClient(this.uri, { tls: true, family: 4, serverApi: ServerApiVersion.v1 });
    await client.connect();
    return { client, db: client.db("Invoice") };
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
    const { client, db } = await this.getDb();
    
    try {
      const invoice = await db.collection("invoices").findOne({ _id: new ObjectId(invoiceId) });
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

      await db.collection("invoices").updateOne(
        { _id: new ObjectId(invoiceId) },
        {
          $set: {
            "payment.status": newStatus,
            "payment.paidAmount": newPaidAmount,
            "payment.balanceDue": balanceDue,
            "payment.paidDate": newStatus === PaymentStatus.PAID ? new Date() : null,
            "payment.lastReminderDate": null // Reset reminder
          },
          $push: { "payment.transactions": transaction }
        }
      );

      if (userEmail) {
        await auditService.logAction({
          userEmail,
          action: 'PAYMENT_RECORDED',
          details: { invoiceId, amount, method: paymentData.method },
          timestamp: new Date()
        });
      }

      return { success: true, newStatus, balanceDue };
    } finally {
      await client.close();
    }
  }

  /**
   * Create a Credit Note
   */
  async createCreditNote(creditNoteData, userEmail) {
    const { client, db } = await this.getDb();
    
    try {
      const creditNote = {
        ...creditNoteData,
        organizationId: creditNoteData.organizationId,
        status: CreditNoteStatus.ISSUED,
        balanceRemaining: creditNoteData.amount,
        createdAt: new Date(),
        createdBy: userEmail,
        applications: [],
        refunds: []
      };

      const result = await db.collection("creditNotes").insertOne(creditNote);
      
      // If linked to an invoice, link it back
      if (creditNoteData.originalInvoiceId) {
        await db.collection("invoices").updateOne(
          { _id: new ObjectId(creditNoteData.originalInvoiceId) },
          { 
            $push: { 
              creditNotes: {
                creditNoteId: result.insertedId,
                creditNoteNumber: creditNoteData.creditNoteNumber,
                amount: creditNoteData.amount,
                appliedDate: new Date(),
                reason: creditNoteData.reason
              }
            }
          }
        );
      }

      return { success: true, creditNoteId: result.insertedId };
    } finally {
      await client.close();
    }
  }

  /**
   * Apply Credit Note to an Invoice
   */
  async applyCreditNote(creditNoteId, invoiceId, amountToApply, userEmail) {
    const { client, db } = await this.getDb();
    
    try {
      const creditNote = await db.collection("creditNotes").findOne({ _id: new ObjectId(creditNoteId) });
      const invoice = await db.collection("invoices").findOne({ _id: new ObjectId(invoiceId) });
      
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

      await db.collection("creditNotes").updateOne(
        { _id: new ObjectId(creditNoteId) },
        {
          $set: { 
            balanceRemaining: newBalance,
            status: newStatus,
            updatedAt: new Date()
          },
          $push: {
            applications: {
              invoiceId: new ObjectId(invoiceId),
              invoiceNumber: invoice.invoiceNumber,
              amountApplied: amountToApply,
              date: new Date()
            }
          }
        }
      );

      return { success: true, remainingCredit: newBalance };
    } finally {
      await client.close();
    }
  }
}

module.exports = new PaymentService();
