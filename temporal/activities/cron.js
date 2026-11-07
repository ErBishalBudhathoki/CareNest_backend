const { MongoClient, ServerApiVersion } = require('mongodb');
const { InvoiceStatus, PaymentStatus } = require('../../models/invoiceSchema');
const logger = require('../../config/logger');
const {
  processRecurringExpenses,
} = require('../../services/recurringExpenseService');

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

/** UTC day key. Stored dates are ISO; do not use local formatting here. */
function _isoDay(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Stable idempotency key for one (parent, scheduled date) pair.
 * Temporal retries the whole activity; a random invoiceNumber made every
 * retry insert a NEW bill for the same period. This key makes retries and
 * overlapping workers converge on a single document.
 */
function _recurringGenerationKey(parent, generationDate) {
  return `recurring:${String(parent._id)}:${_isoDay(generationDate)}`;
}

/** Best-effort unique guard. Sparse so pre-existing invoices are unaffected. */
async function _ensureIdempotencyIndex(collection) {
  try {
    await collection.createIndex(
      { 'metadata.idempotencyKey': 1 },
      { unique: true, sparse: true, name: 'uniq_invoice_idempotency' },
    );
  } catch (error) {
    // If legacy duplicates block the index, the serial upsert below still
    // protects against Temporal retries. Surface the degraded state.
    logger.warn('[Temporal] Could not create invoice idempotency index', {
      error: error.message,
    });
  }
}

/**
 * Activity to scan and generate recurring invoices.
 */
async function processRecurringInvoicesActivity() {
  try {
    const db = await getDb();
    const invoices = db.collection("invoices");
    await _ensureIdempotencyIndex(invoices);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const recurringInvoices = await invoices.find({
      "recurrence.isRecurring": true,
      "recurrence.nextDate": { $lte: today },
      $or: [
        { "recurrence.endDate": { $gte: today } },
        { "recurrence.endDate": null }
      ]
    }).toArray();

    logger.info(`[Temporal] Found ${recurringInvoices.length} recurring invoices to process`);

    let created = 0;
    let skipped = 0;

    for (const parent of recurringInvoices) {
      // 1. Calculate dates
      const generationDate = new Date(parent.recurrence.nextDate);
      const dueDate = new Date(generationDate);
      dueDate.setDate(dueDate.getDate() + (parent.financialSummary.paymentTerms || 7));

      // Unknown frequency used to leave nextDate unchanged, which made the
      // next run bill the same period forever. Refuse to bill instead.
      const frequency = parent.recurrence.frequency;
      const validFrequencies = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'annually'];
      if (!validFrequencies.includes(frequency)) {
        logger.warn('[Temporal] Skipping recurring invoice with invalid frequency', {
          invoiceNumber: parent.invoiceNumber,
          frequency,
        });
        skipped += 1;
        continue;
      }

      const idempotencyKey = _recurringGenerationKey(parent, generationDate);
      const dayKey = _isoDay(generationDate).replace(/-/g, '');
      const invoiceNumber = `INV-R-${String(parent._id)}-${dayKey}`;

      // 2. Create new invoice object
      const newInvoice = {
        ...parent,
        invoiceNumber,
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
          idempotencyKey,
          date: generationDate
        }
      };
      // The child is a NEW document; carrying the parent _id would collide.
      delete newInvoice._id;

      // Atomic insert-or-skip. A Temporal retry, a duplicate schedule or an
      // overlapping worker converges on the same bill instead of double-billing.
      const insertResult = await invoices.updateOne(
        { 'metadata.idempotencyKey': idempotencyKey },
        { $setOnInsert: newInvoice },
        { upsert: true },
      );
      if (insertResult.upsertedCount === 0 && insertResult.matchedCount === 0) {
        skipped += 1;
      } else if (insertResult.upsertedCount > 0) {
        created += 1;
      } else {
        skipped += 1; // already generated on an earlier run
      }

      // 3. Update Parent
      const nextDate = new Date(parent.recurrence.nextDate);
      switch (parent.recurrence.frequency) {
        case 'weekly': nextDate.setDate(nextDate.getDate() + 7); break;
        case 'fortnightly': nextDate.setDate(nextDate.getDate() + 14); break;
        case 'monthly': nextDate.setMonth(nextDate.getMonth() + 1); break;
        case 'quarterly': nextDate.setMonth(nextDate.getMonth() + 3); break;
        case 'annually': nextDate.setFullYear(nextDate.getFullYear() + 1); break;
      }

      await invoices.updateOne(
        { _id: parent._id },
        {
          $set: {
            "recurrence.lastGeneratedDate": generationDate,
            "recurrence.nextDate": nextDate
          }
        }
      );

      logger.info(`[Temporal] Generated recurring invoice for ${parent.invoiceNumber}`, {
        generationDate: _isoDay(generationDate),
      });
    }
    return { processed: recurringInvoices.length, created, skipped };
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

/**
 * Activity to generate due recurring expenses (all organizations).
 * Replaces the legacy in-process node-cron scheduler
 * (recurring_expense_scheduler.js), which misses runs at Cloud Run
 * scale-to-zero and double-fires with multiple instances.
 */
async function processRecurringExpensesActivity() {
  try {
    const results = await processRecurringExpenses(null);
    logger.info('[Temporal] Recurring expenses processed', {
      processed: results.processed,
      created: results.created,
      errors: (results.errors || []).length,
    });
    return {
      processed: results.processed || 0,
      created: results.created || 0,
      errorCount: (results.errors || []).length,
    };
  } catch (error) {
    logger.error('[Temporal] Error processing recurring expenses:', error);
    throw error;
  }
}

module.exports = {
  processRecurringInvoicesActivity,
  processOverdueRemindersActivity,
  processRecurringExpensesActivity,
  // Exported for the idempotency regression test.
  _isoDay,
  _recurringGenerationKey,
};
