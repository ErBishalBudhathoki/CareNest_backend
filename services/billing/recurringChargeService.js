const RecurringInvoiceAgreement = require('../../models/billing/RecurringInvoiceAgreement');
const Invoice = require('../../models/Invoice');
const recurringAgreementService = require('./recurringAgreementService');
const logger = require('../../config/logger');

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

const MAX_AUTOMATIC_RUNS_PER_DAY = 50;

/**
 * Process all recurring agreements whose `nextRunAt` is in the past and
 * which are still `active`. For each, create a child invoice from the
 * template, then create and confirm a PaymentIntent on the connected
 * account using the saved payment method. Idempotency keys are derived
 * from the agreement and the scheduled date so retries cannot duplicate
 * charges.
 */
async function processRecurringCharges({ now = new Date() } = {}) {
  if (!stripe) return { processed: 0, skipped: 'stripe-not-configured' };

  const candidates = await RecurringInvoiceAgreement.find({
    status: 'active',
    nextRunAt: { $lte: now },
  })
    .sort({ nextRunAt: 1 })
    .limit(MAX_AUTOMATIC_RUNS_PER_DAY);

  let processed = 0;
  for (const agreement of candidates) {
    try {
      const idempotencyKey = `rec-${agreement._id}-${agreement.nextRunAt.toISOString().slice(0, 10)}`;
      const paymentIntent = await stripe.paymentIntents.create(
        {
          amount: agreement.amountCents,
          currency: agreement.currency.toLowerCase(),
          customer: agreement.stripeCustomerId,
          payment_method: agreement.stripePaymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            organizationId: String(agreement.organizationId),
            agreementId: String(agreement._id),
          },
        },
        { stripeAccount: agreement.stripeAccountId, idempotencyKey }
      );

      await recordChildInvoice(agreement, paymentIntent);
      advanceNextRun(agreement, paymentIntent);
      processed += 1;
    } catch (error) {
      logger.error('Recurring charge failed', {
        agreementId: String(agreement._id),
        error: error.message,
      });
      if (error.code === 'authentication_required' || error.code === 'card_declined') {
        agreement.status = 'paused';
        await agreement.save();
      }
    }
  }
  return { processed };
}

function advanceNextRun(agreement, paymentIntent) {
  agreement.lastRunAt = new Date();
  const cadenceDays = { weekly: 7, fortnightly: 14, monthly: 30 }[agreement.frequency] || 30;
  agreement.nextRunAt = new Date(agreement.nextRunAt.getTime() + cadenceDays * 24 * 60 * 60 * 1000);
  if (paymentIntent.status === 'succeeded') {
    agreement.status = 'active';
  }
  return agreement.save();
}

async function recordChildInvoice(agreement, paymentIntent) {
  const template = await Invoice.findById(agreement.invoiceTemplateId).lean();
  if (!template) return;
  const child = {
    ...template,
    _id: undefined,
    invoiceNumber: `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    parentInvoiceId: template._id,
    recurrence: { isRecurring: false, parentInvoiceId: template._id },
    payment: {
      status: paymentIntent.status === 'succeeded' ? 'paid' : 'pending',
      paidAmount: paymentIntent.amount / 100,
      balanceDue: 0,
      transactions: [
        {
          date: new Date(),
          amount: paymentIntent.amount / 100,
          method: 'stripe',
          reference: paymentIntent.id,
          status: paymentIntent.status,
          notes: 'Auto-charge via recurring agreement',
        },
      ],
    },
    metadata: {
      ...template.metadata,
      generationMethod: 'recurring_agreement',
      agreementId: String(agreement._id),
    },
  };
  await Invoice.create(child);
}

module.exports = { processRecurringCharges };
