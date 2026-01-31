const cron = require('node-cron');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { InvoiceStatus, PaymentStatus } = require('../models/invoiceSchema');
// const paymentService = require('../services/paymentService');
// const emailService = require('../services/emailService'); // Assuming this exists
const logger = require('../config/logger');

const uri = process.env.MONGODB_URI;

class Scheduler {
  constructor() {
    this.client = new MongoClient(uri, { tls: true, family: 4, serverApi: ServerApiVersion.v1 });
  }

  start() {
    // Skip cron jobs in production Cloud Functions environment
    // Use Google Cloud Scheduler to trigger HTTP endpoints instead for production
    const isProductionServerless = process.env.NODE_ENV === 'production' &&
      (process.env.FUNCTIONS_EMULATOR === 'true' ||
        process.env.K_SERVICE ||  // Cloud Run/Functions indicator
        process.env.FUNCTION_TARGET);  // Cloud Functions indicator

    if (isProductionServerless) {
      logger.info('Skipping in-process invoice/reminder scheduler in production Cloud Functions');
      return;
    }

    logger.info('Starting Cron Scheduler...');

    // Run every day at midnight
    cron.schedule('0 0 * * *', async () => {
      logger.info('Running daily scheduled tasks');
      await this.processRecurringInvoices();
      await this.processOverdueReminders();
    });
  }

  async getDb() {
    if (!this.client.topology || !this.client.topology.isConnected()) {
      await this.client.connect();
    }
    return this.client.db("Invoice");
  }

  /**
   * Process Recurring Invoices
   */
  async processRecurringInvoices() {
    try {
      const db = await this.getDb();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const recurringInvoices = await db.collection("invoices").find({
        "recurrence.isRecurring": true,
        "recurrence.nextDate": { $lte: today },
        $or: [
          { "recurrence.endDate": { $gte: today } },
          { "recurrence.endDate": null }
        ]
      }).toArray();

      logger.info(`Found ${recurringInvoices.length} recurring invoices to process`);

      for (const parent of recurringInvoices) {
        await this.generateChildInvoice(db, parent);
      }
    } catch (error) {
      logger.error('Error processing recurring invoices:', error);
    }
  }

  async generateChildInvoice(db, parent) {
    try {
      // 1. Calculate dates
      const generationDate = new Date(parent.recurrence.nextDate);
      const dueDate = new Date(generationDate);
      dueDate.setDate(dueDate.getDate() + (parent.financialSummary.paymentTerms || 7));

      // 2. Create new invoice object (Clone)
      const newInvoice = {
        ...parent,
        _id: undefined, // New ID
        invoiceNumber: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`, // Simple generation, should use proper sequence
        financialSummary: {
          ...parent.financialSummary,
          dueDate: dueDate
        },
        payment: {
          status: PaymentStatus.PENDING,
          paidAmount: 0,
          balanceDue: parent.financialSummary.totalAmount,
          transactions: []
        },
        recurrence: {
          isRecurring: false, // Child is not recurring itself
          parentInvoiceId: parent._id
        },
        workflow: {
          ...parent.workflow,
          status: InvoiceStatus.GENERATED,
          currentStep: 'generated'
        },
        auditTrail: {
          createdBy: 'system',
          createdAt: new Date(),
          version: 1,
          changeHistory: []
        },
        metadata: {
          ...parent.metadata,
          generationMethod: 'scheduled',
          date: generationDate
        }
      };

      await db.collection("invoices").insertOne(newInvoice);

      // 3. Update Parent
      const nextDate = new Date(parent.recurrence.nextDate);
      switch (parent.recurrence.frequency) {
        case 'weekly': nextDate.setDate(nextDate.getDate() + 7); break;
        case 'fortnightly': nextDate.setDate(nextDate.getDate() + 14); break;
        case 'monthly': nextDate.setMonth(nextDate.getMonth() + 1); break;
        case 'quarterly': nextDate.setMonth(nextDate.getMonth() + 3); break;
        case 'annually': nextDate.setFullYear(nextDate.getFullYear() + 1); break;
      }

      await db.collection("invoices").updateOne(
        { _id: parent._id },
        {
          $set: {
            "recurrence.lastGeneratedDate": generationDate,
            "recurrence.nextDate": nextDate
          }
        }
      );

      logger.info(`Generated recurring invoice for ${parent.invoiceNumber}`);

    } catch (error) {
      logger.error(`Failed to generate child invoice for ${parent._id}`, error);
    }
  }

  /**
   * Process Overdue Reminders
   */
  async processOverdueReminders() {
    try {
      const db = await this.getDb();
      const today = new Date();

      // Find overdue invoices that haven't had a reminder sent in last 7 days
      const overdueInvoices = await db.collection("invoices").find({
        "payment.status": { $ne: PaymentStatus.PAID },
        "financialSummary.dueDate": { $lt: today },
        $or: [
          { "payment.lastReminderDate": null },
          { "payment.lastReminderDate": { $lt: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000) } }
        ]
      }).toArray();

      logger.info(`Found ${overdueInvoices.length} invoices needing reminders`);

      for (const invoice of overdueInvoices) {
        // Send email (Mocked for now as we haven't updated EmailService fully)
        // await emailService.sendOverdueReminder(invoice);

        await db.collection("invoices").updateOne(
          { _id: invoice._id },
          {
            $set: {
              "payment.status": PaymentStatus.OVERDUE,
              "payment.lastReminderDate": new Date()
            },
            $inc: { "payment.remindersSent": 1 }
          }
        );
      }

    } catch (error) {
      logger.error('Error processing overdue reminders:', error);
    }
  }
}

module.exports = new Scheduler();
