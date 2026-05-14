const { MongoClient, ServerApiVersion } = require('mongodb');
const { InvoiceStatus, PaymentStatus } = require('../../models/invoiceSchema');
const logger = require('../../config/logger');

// Note: Ensure MONGODB_URI is available in the worker environment
const uri = process.env.MONGODB_URI;

let dbClient = null;

async function getDb() {
  if (!dbClient) {
    if (!uri) throw new Error('MONGODB_URI is not configured');
    dbClient = new MongoClient(uri, { tls: true, family: 4, serverApi: ServerApiVersion.v1 });
  }
  if (!dbClient.topology || !dbClient.topology.isConnected()) {
    await dbClient.connect();
  }
  return dbClient.db("Invoice");
}

/**
 * Activity to scan and generate recurring invoices.
 */
async function processRecurringInvoicesActivity() {
  try {
    const db = await getDb();
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

    logger.info(`[Temporal] Found ${recurringInvoices.length} recurring invoices to process`);

    for (const parent of recurringInvoices) {
      // 1. Calculate dates
      const generationDate = new Date(parent.recurrence.nextDate);
      const dueDate = new Date(generationDate);
      dueDate.setDate(dueDate.getDate() + (parent.financialSummary.paymentTerms || 7));

      // 2. Create new invoice object
      const newInvoice = {
        ...parent,
        _id: undefined, 
        invoiceNumber: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
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
          isRecurring: false, 
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
          generationMethod: 'temporal_scheduled',
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

      logger.info(`[Temporal] Generated recurring invoice for ${parent.invoiceNumber}`);
    }
    return { processed: recurringInvoices.length };
  } catch (error) {
    logger.error('[Temporal] Error processing recurring invoices:', error);
    throw error;
  }
}

/**
 * Activity to scan and send overdue reminders.
 */
async function processOverdueRemindersActivity() {
  try {
    const db = await getDb();
    const today = new Date();

    const overdueInvoices = await db.collection("invoices").find({
      "payment.status": { $ne: PaymentStatus.PAID },
      "financialSummary.dueDate": { $lt: today },
      $or: [
        { "payment.lastReminderDate": null },
        { "payment.lastReminderDate": { $lt: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000) } }
      ]
    }).toArray();

    logger.info(`[Temporal] Found ${overdueInvoices.length} invoices needing reminders`);

    for (const invoice of overdueInvoices) {
      // Send email logic goes here...
      
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
    return { processed: overdueInvoices.length };
  } catch (error) {
    logger.error('[Temporal] Error processing overdue reminders:', error);
    throw error;
  }
}

module.exports = {
  processRecurringInvoicesActivity,
  processOverdueRemindersActivity
};
